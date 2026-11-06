import type { CiPlan } from "../domains/ci/planner";
import type { CiTask } from "../domains/ci/policy";
import type { CiResult } from "../domains/ci/runner";
import { appendFile, readFile } from "node:fs/promises";
import process from "node:process";
import { Command } from "commander";
import { loadConfig } from "../config/loader";
import { ciPlanSchema, collectCiPlan, executableTargets, selectShard, shardBuilds, shardRequirements } from "../domains/ci/planner";
import { ciSchedulingSchema, ciTasks } from "../domains/ci/policy";
import { executeCommand } from "../domains/ci/process";
import { runCiPlan } from "../domains/ci/runner";
import { findWorkspaceRoot } from "../utils/workspace";

interface CiOptions { base?: string; tasks: string; plan?: string; shard?: string; exclude?: string[] }

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
        : await collectCiPlan(root, policy, tasks, options.base, buildOrder);
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
                        process.stdout.write(`CI build ${builds.length} prerequisite packages: ${builds.join(" ") || "none"}\n`);
                        for (const entry of builds) {
                            controller.signal.throwIfAborted();
                            const exitCode = await executeCommand("pnpm", ["--filter", entry, "run", "build"], loaded.root, controller.signal);
                            if (exitCode !== 0) throw new Error(`build of ${entry} exited ${exitCode}`);
                        }
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
