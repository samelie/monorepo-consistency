import type { CiPlan } from "../domains/ci/planner";
import type { CiTask } from "../domains/ci/policy";
import type { CiResult } from "../domains/ci/runner";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { Command } from "commander";
import { z } from "zod/v4";
import { loadConfig } from "../config/loader";
import { buildCacheEntries, buildCacheManifest, cleanBuildOutputs, isBuildCached, markBuilt } from "../domains/ci/build-cache";
import { ciPlanSchema, collectCiPlan, executableTargets, selectShard, shardBuilds, shardRequirements } from "../domains/ci/planner";
import { ciSchedulingSchema, ciTasks } from "../domains/ci/policy";
import { executeCommand } from "../domains/ci/process";
import { runCiPlan } from "../domains/ci/runner";
import { findWorkspaceRoot, getWorkspaceInfo } from "../utils/workspace";

interface CiOptions {
    base?: string;
    tasks: string;
    plan?: string;
    shard?: string;
    exclude?: string[];
    durations?: string;
    durationsOut?: string;
    cacheManifest?: boolean;
    useCache?: boolean;
}

const durationsSchema = z.record(z.string(), z.number().nonnegative());

// a missing or unreadable record only costs balance, never the run
const readDurations = async (file?: string): Promise<Record<string, number>> => {
    if (!file) return {};
    try {
        return durationsSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch {
        return {};
    }
};

// merges this invocation's measured seconds into the file, so one file spans a shard's task steps
const recordDurations = async (file: string, results: readonly CiResult[]) => {
    const measured = Object.fromEntries(results.map(result => [`${result.target.package}:${result.target.task}`, Math.round(result.durationMs / 100) / 10]));
    await writeFile(file, `${JSON.stringify({ ...await readDurations(file), ...measured }, null, 2)}\n`);
};

const parseTasks = (value: string) => value.split(",").map(entry => {
    const task = ciTasks.find(task => task === entry);
    if (!task) throw new Error(`Unknown CI task: ${entry}`);
    return task;
});

const parseShard = (value: string) => {
    const match = /^(\d+)\/(\d+)$/.exec(value);
    if (!match) throw new Error(`Invalid --shard ${value}; expected <index>/<count>`);
    return { shard: Number(match[1]), of: Number(match[2]) };
};

const loadPlan = async (options: CiOptions, globals: { cwd?: string; config?: string }, tasks: readonly CiTask[]) => {
    const root = await findWorkspaceRoot(globals.cwd);
    const config = await loadConfig({ cwd: root, configPath: globals.config });
    const policy = ciSchedulingSchema.parse(config.ci?.scheduling ?? {});
    const buildOrder = (config as { build?: { orderedPackages?: string[] } }).build?.orderedPackages ?? [];
    if (options.plan && options.base) throw new Error("Use either --plan or --base");
    let plan: CiPlan = options.plan
        ? ciPlanSchema.parse(JSON.parse(await readFile(options.plan, "utf8")))
        : await collectCiPlan(root, policy, tasks, options.base, buildOrder, await readDurations(options.durations));
    if (options.shard) {
        const { shard, of } = parseShard(options.shard);
        plan = selectShard(plan, shard, of);
    }
    return { root, plan, buildOrder };
};

const filterTasks = (plan: CiPlan, tasks: readonly CiTask[]): CiPlan => ({
    ...plan,
    targets: plan.targets.filter(target => tasks.includes(target.task)),
    omitted: plan.omitted.filter(target => tasks.includes(target.task)),
    placeholders: plan.placeholders.filter(target => tasks.includes(target.task)),
});

const summarize = (plan: CiPlan, results: CiResult[]) => {
    const failures = results.filter(result => result.exitCode !== 0);
    const slowest = [...results].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
    const row = (result: CiResult) => `| ${result.target.package}:${result.target.task} | ${result.timedOut ? "timed out" : result.exitCode} | ${(result.durationMs / 1000).toFixed(1)}s |`;
    return [
        `### CI ${plan.reason}: ${results.length} executed, ${failures.length} failed`,
        "",
        ...(failures.length > 0 ? ["**Failures**", "", "| target | exit | duration |", "|---|---|---|", ...failures.map(row), ""] : []),
        "**Slowest**",
        "",
        "| target | exit | duration |",
        "|---|---|---|",
        ...slowest.map(row),
        "",
    ].join("\n");
};

export const createCiCommand = (): Command => {
    const ci = new Command("ci").description("Plan and run bounded direct workspace checks");
    for (const name of ["plan", "run", "mirror", "matrix", "build"]) {
        const description = {
            plan: "Print exact CI targets as JSON",
            run: "Run the same planned CI targets",
            mirror: "Run the same planned CI targets",
            matrix: "Print the GitHub Actions shard matrix (with per-shard requirements) for a plan",
            build: "Build only the build.orderedPackages the planned packages depend on, in order",
        }[name];
        ci.command(name)
            .description(description!)
            .option("--base <ref>", "select changes and dependents since a verified git ref")
            .option("--plan <file>", "execute a previously printed JSON plan")
            .option("--shard <index/count>", "restrict to one deterministic shard of the plan")
            .option("--exclude <packages...>", "build: skip packages already built by the caller")
            .option("--durations <file>", "plan: measured {\"pkg:task\": seconds} that size and balance the shards")
            .option("--durations-out <file>", "run: merge each executed target's measured seconds into this file")
            .option("--cache-manifest", "build: print the actions/cache key and paths for this build list as JSON")
            .option("--use-cache", "build: skip packages whose restored output matches their content key")
            .option("--tasks <tasks>", "comma-separated test,types,lint,knip", name === "mirror" ? "types,lint" : "test,types,lint,knip")
            .action(async (options: CiOptions, command: Command) => {
                const controller = new AbortController();
                const interrupt = () => controller.abort(new Error("CI cancelled by SIGINT"));
                const terminate = () => controller.abort(new Error("CI cancelled by SIGTERM"));
                process.on("SIGINT", interrupt);
                process.on("SIGTERM", terminate);
                try {
                    const tasks = parseTasks(options.tasks);
                    const loaded = await loadPlan(options, command.optsWithGlobals(), tasks);
                    const plan = filterTasks(loaded.plan, tasks);
                    controller.signal.throwIfAborted();
                    if (name === "plan") {
                        process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
                        return;
                    }
                    if (name === "build") {
                        const builds = shardBuilds(plan, loaded.buildOrder).filter(entry => !options.exclude?.includes(entry));
                        const cacheable = options.cacheManifest || options.useCache;
                        const workspacePackages = cacheable ? (await getWorkspaceInfo(loaded.root)).packages : [];
                        const entries = cacheable ? await buildCacheEntries(loaded.root, workspacePackages, builds) : [];
                        if (options.cacheManifest) {
                            const ordered = loaded.buildOrder.filter(entry => !options.exclude?.includes(entry));
                            const pathPackages = workspacePackages.filter(pkg => ordered.includes(pkg.name));
                            process.stdout.write(`${JSON.stringify(buildCacheManifest(entries, process.env.RUNNER_OS ?? process.platform, pathPackages, loaded.root))}\n`);
                            return;
                        }
                        process.stdout.write(`CI build ${builds.length} prerequisite packages: ${builds.join(" ") || "none"}\n`);
                        let reused = 0;
                        for (const [index, build] of builds.entries()) {
                            controller.signal.throwIfAborted();
                            const entry = entries[index];
                            if (entry && await isBuildCached(loaded.root, entry)) {
                                reused++;
                                continue;
                            }
                            if (entry) await cleanBuildOutputs(loaded.root, entry);
                            const exitCode = await executeCommand("pnpm", ["--filter", build, "run", "build"], loaded.root, controller.signal);
                            if (exitCode !== 0) throw new Error(`build of ${build} exited ${exitCode}`);
                            if (entry) await markBuilt(loaded.root, entry);
                        }
                        if (options.useCache) process.stdout.write(`CI build reused ${reused} cached, built ${builds.length - reused}\n`);
                        return;
                    }
                    if (name === "matrix") {
                        const include = Array.from({ length: plan.shards }, (_, index) => {
                            const shard = selectShard(plan, index + 1, plan.shards);
                            return { shard: index + 1, of: plan.shards, targets: shard.targets.length, requires: shardRequirements(shard).join(" ") };
                        });
                        process.stdout.write(`${JSON.stringify({ include })}\n`);
                        return;
                    }
                    const runnable = { ...plan, targets: executableTargets(plan) };
                    process.stdout.write(`CI ${plan.reason}${options.shard ? ` (shard ${options.shard})` : ""}: ${runnable.targets.length} scripts, ${plan.omitted.length} omitted, ${plan.placeholders.length} placeholders not executed, ${plan.timeoutMinutes} min per target\n`);
                    const results = await runCiPlan(runnable, loaded.root, undefined, controller.signal, { grouped: process.env.GITHUB_ACTIONS === "true" });
                    const failures = results.filter(result => result.exitCode !== 0);
                    if (options.durationsOut) await recordDurations(options.durationsOut, results);
                    const summary = summarize(plan, results);
                    process.stdout.write(`${summary}\n`);
                    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
                    process.exitCode = controller.signal.aborted || failures.length > 0 || results.length !== runnable.targets.length ? 1 : 0;
                } catch (error) {
                    process.stderr.write(`CI failed: ${String(error)}\n`);
                    process.exitCode = 1;
                } finally {
                    process.removeListener("SIGINT", interrupt);
                    process.removeListener("SIGTERM", terminate);
                }
            });
    }
    return ci;
};
