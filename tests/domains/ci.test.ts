import type { CiPlan } from "../../src/domains/ci/planner";
import type { PackageInfo, WorkspaceInfo } from "../../src/types/index";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ciPlanSchema, executableTargets, planCi, selectShard, shardBuilds, shardRequirements } from "../../src/domains/ci/planner";
import { ciSchedulingSchema } from "../../src/domains/ci/policy";
import { captureCommand } from "../../src/domains/ci/process";
import { runCiPlan } from "../../src/domains/ci/runner";

const pkg = (name: string, path: string, scripts = { test: "vitest run", types: "tsc --noEmit", lint: "eslint .", knip: "knip" }): PackageInfo =>
    ({ name, path: `/repo/${path}`, version: "1", private: true, scripts });
const workspace: WorkspaceInfo = {
    root: "/repo",
    lockfile: "/repo/pnpm-lock.yaml",
    workspaceFile: "/repo/pnpm-workspace.yaml",
    packages: [
        pkg("root", "", { test: "pnpm -r test", types: "pnpm -r types", lint: "pnpm -r lint", knip: "pnpm -r knip" }),
        pkg("mixed", "group", { "test": "pnpm -r test", "types": "pnpm -r types", "lint": "pnpm -r lint", "knip": "knip && pnpm -r knip", "knip:local": "knip" }),
        pkg("leaf", "group/leaf"), pkg("consumer", "consumer"),
        pkg("borrowed", "borrowed", { test: "pnpm -F sdk exec vitest run --config own.config.ts" }),
    ],
};
const policy = ciSchedulingSchema.parse({
    concurrency: 2,
    allOnChange: ["package.json", "pnpm-lock.yaml", ".github/**", "monorepo.config.json"],
    packages: {
        root: Object.fromEntries(["test", "types", "lint", "knip"].map(task => [task, { kind: "children", reason: "root wrapper" }])),
        mixed: { test: { kind: "children", reason: "wrapper" }, types: { kind: "children", reason: "wrapper" }, lint: { kind: "children", reason: "wrapper" }, knip: { kind: "script", script: "knip:local" } },
    },
});

describe("ci planning", () => {
    it("deduplicates changed and dependent targets while preserving genuine pnpm-containing checks", () => {
        const plan = planCi(workspace, policy, ["test", "test"], { affected: ["leaf", "leaf", "consumer", "borrowed"], files: ["group/leaf/src/a.ts"] });
        expect(plan.targets.map(target => target.package)).toEqual(["borrowed", "consumer", "leaf"]);
        expect(plan.targets.find(target => target.package === "borrowed")?.args).toEqual(["--filter", "borrowed", "run", "test"]);
        expect(plan.packages).not.toContain("mixed");
    });
    it.each(["package.json", "pnpm-lock.yaml", "monorepo.config.json", ".github/workflows/ci.yaml"])("expands %s changes to all direct checks", file => {
        const plan = planCi(workspace, policy, ["test", "types", "lint", "knip"], { affected: ["root"], files: [file] });
        expect(plan.targets.map(target => `${target.package}:${target.task}`)).toEqual([
            "borrowed:test", "consumer:test", "consumer:types", "consumer:lint", "consumer:knip",
            "leaf:test", "leaf:types", "leaf:lint", "leaf:knip", "mixed:knip",
        ]);
        expect(plan.targets.some(target => target.package === "root")).toBe(false);
        expect(plan.targets.find(target => target.package === "mixed")?.args).toEqual(["--filter", "mixed", "run", "knip:local"]);
    });
    it("expands an aggregator-only change and preserves its mixed local check", () => {
        const plan = planCi(workspace, policy, ["test", "knip"], { affected: ["mixed"], files: ["group/package.json"] });
        expect(plan.targets.map(target => `${target.package}:${target.task}`)).toEqual(["leaf:test", "leaf:knip", "mixed:knip"]);
        expect(plan.omitted.map(target => target.package)).toEqual(["mixed"]);
    });
    it("reports existing echo placeholders distinctly without silently dropping scripts", () => {
        const local = { ...workspace, packages: [pkg("empty", "empty", { test: "echo no tests" })] };
        const plan = planCi(local, ciSchedulingSchema.parse({}), ["test"]);
        expect(plan.targets).toHaveLength(1);
        expect(plan.placeholders).toEqual([{ package: "empty", task: "test", script: "echo no tests" }]);
    });
    it("rejects invalid inventories, policy aliases, concurrency and duplicate persisted plans", () => {
        expect(() => planCi({ ...workspace, packages: [...workspace.packages, workspace.packages[0]!] }, policy, ["test"])).toThrow("duplicate");
        expect(() => planCi(workspace, { ...policy, concurrency: 0 }, ["test"])).toThrow("concurrency");
        expect(() => planCi(workspace, { ...policy, packages: { missing: { test: { kind: "children", reason: "bad" } } } }, ["test"])).toThrow("unknown");
        expect(() => planCi(workspace, { ...policy, packages: { leaf: { test: { kind: "script", script: "missing" } } } }, ["test"])).toThrow("Missing CI script");
        const plan = planCi(workspace, policy, ["test"]);
        expect(() => ciPlanSchema.parse({ ...plan, targets: [...plan.targets, plan.targets[0]] })).toThrow("Duplicate");
        expect(() => planCi(workspace, policy, ["test"], { affected: ["missing"], files: [] })).toThrow("unknown");
    });
    it("allows a visible empty selection only when no relevant changes are selected", () => {
        const plan = planCi(workspace, policy, ["test"], { affected: [], files: ["README.md"] });
        expect(plan.targets).toEqual([]);
        expect(plan.reason).toBe("changed packages and dependents");
    });
});

describe("ci execution", () => {
    it("uses installed pnpm dependent selection on a real workspace graph", async () => {
        const dir = await mkdtemp(join(tmpdir(), "ci-selection-"));
        try {
            await writeFile(join(dir, "package.json"), JSON.stringify({ name: "fixture-root", private: true }));
            await writeFile(join(dir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
            for (const [name, dependencies] of [["a", {}], ["b", { a: "workspace:*" }], ["c", { b: "workspace:*" }], ["unrelated", {}]] as const) {
                await mkdir(join(dir, "packages", name), { recursive: true });
                await writeFile(join(dir, "packages", name, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies }));
            }
            const selected = JSON.parse(await captureCommand("pnpm", ["--filter", "...a", "list", "--depth=-1", "--json"], dir)) as { name: string }[];
            expect(selected.map(pkg => pkg.name).sort()).toEqual(["a", "b", "c"]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
    it("bounds concurrency, serializes each package and executes every target once", async () => {
        const plan = planCi(workspace, policy, ["test", "types", "lint", "knip"]);
        let active = 0; let peak = 0;
        const running = new Set<string>(); const seen: string[] = [];
        const results = await runCiPlan(plan, "/repo", async (_command, args) => {
            const name = args[1]!;
            expect(running.has(name)).toBe(false);
            running.add(name);
            active++;
            peak = Math.max(peak, active);
            seen.push(`${name}:${args[3]}`);
            await new Promise(resolve => setTimeout(resolve, 5));
            active--;
            running.delete(name);
            return name === "consumer" ? 7 : 0;
        });
        expect(peak).toBe(2);
        expect(results).toHaveLength(plan.targets.length);
        expect(new Set(seen).size).toBe(plan.targets.length);
        expect(results.filter(result => result.exitCode === 7)).toHaveLength(4);
    });
    it.each(["test", "types", "lint", "knip"] as const)("preserves real subprocess %s failure", async task => {
        const dir = await mkdtemp(join(tmpdir(), "ci-runner-"));
        try {
            const probe = join(dir, "fail.mjs");
            await writeFile(probe, "process.exit(17)\n");
            const plan = { ...planCi(workspace, policy, [task]), targets: [{ package: "failure", task, command: process.execPath, args: [probe] }] };
            const results = await runCiPlan(plan, dir);
            expect(results[0]?.exitCode).toBe(17);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe("ci policy extensions", () => {
    const local: WorkspaceInfo = {
        ...workspace,
        packages: [
            pkg("browser", "browser", { test: "vitest run", lint: "eslint ." }),
            pkg("queue", "queue", { test: "vitest run", types: "tsc", knip: "knip" }),
            pkg("gated", "gated", { test: "vitest run", lint: "eslint ." }),
            pkg("empty", "empty", { test: "echo none", types: "echo none" }),
        ].map(entry => entry.name === "browser" ? { ...entry, devDependencies: { "@vitest/browser-playwright": "^5" } } : entry),
    };
    const extended = ciSchedulingSchema.parse({
        maxShards: 3,
        shardWeight: 2,
        requires: { queue: ["redis"] },
        packages: { gated: { test: { kind: "skip", reason: "owned by another gate" } } },
    });

    it("omits skipped tasks with their reason while keeping the package's other checks", () => {
        const plan = planCi(local, extended, ["test", "lint"]);
        expect(plan.omitted).toEqual([{ package: "gated", task: "test", reason: "owned by another gate" }]);
        expect(plan.targets.map(target => `${target.package}:${target.task}`)).toContain("gated:lint");
        expect(plan.targets.map(target => `${target.package}:${target.task}`)).not.toContain("gated:test");
    });

    it("infers chromium from a browser driver dependency and merges declared requirements", () => {
        const plan = planCi(local, extended, ["test"]);
        expect(plan.requires).toEqual({ browser: ["chromium"], queue: ["redis"] });
        expect(() => planCi(local, { ...extended, requires: { missing: ["redis"] } }, ["test"])).toThrow("unknown package");
        expect(() => ciSchedulingSchema.parse({ requires: { queue: ["postgres"] } })).toThrow();
    });

    it("partitions executable targets into deterministic whole-package shards", () => {
        const plan = planCi(local, extended, ["test", "types", "lint", "knip"]);
        expect(plan.shards).toBe(3);
        const shards = [1, 2, 3].map(index => selectShard(plan, index, 3));
        const covered = shards.flatMap(shard => shard.targets.map(target => `${target.package}:${target.task}`)).sort();
        expect(covered).toEqual(executableTargets(plan).map(target => `${target.package}:${target.task}`).sort());
        expect(covered.some(target => target.startsWith("empty:"))).toBe(false);
        expect(shards.flatMap(shard => shard.packages).sort()).toEqual([...plan.packages].sort());
        for (const shard of shards) expect(shard.targets.every(target => shard.packages.includes(target.package))).toBe(true);
        expect(shards[0]!.placeholders.map(entry => entry.package)).toContain("empty");
        expect(selectShard(plan, 2, 3)).toEqual(selectShard(plan, 2, 3));
        expect(() => selectShard(plan, 4, 3)).toThrow("Invalid shard");
        expect(() => selectShard(plan, 1, 2)).toThrow("Invalid shard");
        const withQueue = shards.find(shard => shard.packages.includes("queue"))!;
        expect(shardRequirements(withQueue)).toContain("redis");
        expect(shards.filter(shard => shardRequirements(shard).includes("redis"))).toHaveLength(1);
    });

    it("caps the shard count and keeps small selections on one shard", () => {
        expect(planCi(local, { ...extended, maxShards: 2 }, ["test", "types", "lint", "knip"]).shards).toBe(2);
        expect(planCi(local, ciSchedulingSchema.parse({}), ["test"]).shards).toBe(1);
    });

    it("only provisions requirements for packages whose tests execute", () => {
        const plan = planCi(local, extended, ["lint"]);
        expect(shardRequirements(plan)).toEqual([]);
    });

    it("builds only the ordered prerequisites in each package's workspace dependency closure", () => {
        const graph: WorkspaceInfo = {
            ...workspace,
            packages: [
                { ...pkg("tool", "tool", { build: "tsup" }) },
                { ...pkg("proto", "proto", { build: "tsup" }), devDependencies: { tool: "workspace:*" } },
                { ...pkg("server", "server"), dependencies: { proto: "workspace:*" } },
                { ...pkg("alone", "alone") },
            ],
        };
        const plan = planCi(graph, ciSchedulingSchema.parse({}), ["test"], undefined, ["tool", "unrelated", "proto"]);
        expect(plan.builds).toEqual({ tool: ["tool"], proto: ["tool", "proto"], server: ["tool", "proto"] });
        expect(shardBuilds({ ...plan, packages: ["alone"] }, ["tool", "proto"])).toEqual([]);
        expect(shardBuilds({ ...plan, packages: ["server", "alone"] }, ["proto", "tool"])).toEqual(["proto", "tool"]);
    });
});

describe("ci runner bounds and reporting", () => {
    const single = (command: string, args: string[]): CiPlan => ({
        reason: "runner", concurrency: 1, timeoutMinutes: 15, shards: 1, packages: ["a"], omitted: [], placeholders: [], requires: {}, builds: {},
        targets: [{ package: "a", task: "test", command, args }],
    });

    it("kills a hung target at the timeout, reports 124 and continues", async () => {
        const plan = single(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
        plan.targets.push({ package: "b", task: "test", command: process.execPath, args: ["-e", "process.exit(0)"] });
        plan.concurrency = 2;
        const started = performance.now();
        const results = await runCiPlan(plan, process.cwd(), undefined, undefined, { timeoutMs: 3000, write: () => {} });
        expect(performance.now() - started).toBeLessThan(15_000);
        expect(results.find(result => result.target.package === "a")).toMatchObject({ exitCode: 124, timedOut: true });
        expect(results.find(result => result.target.package === "b")).toMatchObject({ exitCode: 0 });
    });

    it("prints each target's output as one block and annotates failures", async () => {
        const lines: string[] = [];
        const write = (text: string) => lines.push(text);
        await runCiPlan(single(process.execPath, ["-e", "console.log('ok-output')"]), process.cwd(), undefined, undefined, { grouped: true, write });
        await runCiPlan(single(process.execPath, ["-e", "console.error('bad-output'); process.exit(3)"]), process.cwd(), undefined, undefined, { grouped: true, write });
        const text = lines.join("");
        expect(text).toMatch(/::group::pass a:test exit 0 in [\d.]+s\nok-output\n::endgroup::/);
        expect(text).toContain("::error title=a:test::exit 3");
        expect(text).toMatch(/---- FAIL a:test exit 3 in [\d.]+s ----\nbad-output\n---- end a:test ----/);
    });
});

it("keeps four blocking read-only sharded gates, the planner checks and the moirai clone gate", async () => {
    const path = fileURLToPath(new URL("../../../../.github/workflows/ci.yaml", import.meta.url));
    const workflow = parse(await readFile(path, "utf8")) as { jobs: Record<string, { steps: { "name"?: string; "run"?: string; "continue-on-error"?: boolean }[] }> };
    const steps = workflow.jobs.validate!.steps;
    for (const [name, task] of [["Run tests", "test"], ["Run type checking", "types"], ["Run linting", "lint"], ["Run Knip analysis", "knip"]]) {
        const step = steps.find(step => step.name === name);
        expect(step?.run).toContain(`--tasks ${task}`);
        expect(step?.run).toContain(`--shard "$CI_SHARD"`);
        expect(step?.["continue-on-error"]).toBeUndefined();
        expect(step?.run).not.toContain("lint:fix");
    }
    const plan = workflow.jobs.plan!.steps;
    expect(plan.some(step => step.run?.includes("enforce:check"))).toBe(true);
    expect(plan.some(step => step.run?.includes("ci matrix"))).toBe(true);
    expect(workflow.jobs["moirai-clone-gate"]?.steps.at(-1)?.run).toContain("gate:clone");
});

it("never omits the moirai import-boundary lints and hands every member test to the clone gate", async () => {
    const path = fileURLToPath(new URL("../../../../monorepo.config.json", import.meta.url));
    const config = JSON.parse(await readFile(path, "utf8")) as { ci: { scheduling: unknown } };
    const scheduling = ciSchedulingSchema.parse(config.ci.scheduling);
    for (const name of ["@moirai/eng-cli", "@moirai/db"]) expect(scheduling.packages[name]?.lint).toBeUndefined();
    const skipped = Object.entries(scheduling.packages).filter(([, rules]) => rules.test?.kind === "skip").map(([name]) => name);
    expect(skipped.every(name => name.startsWith("@moirai/"))).toBe(true);
    expect(skipped).toContain("@moirai/eng-cli");
});
