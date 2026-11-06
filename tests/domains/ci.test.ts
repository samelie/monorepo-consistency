import type { PackageInfo, WorkspaceInfo } from "../../src/types/index";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ciPlanSchema, planCi } from "../../src/domains/ci/planner";
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
        expect(plan.wrappers.map(target => target.package)).toEqual(["mixed"]);
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

it("keeps four blocking read-only workflow gates and both moirai gates", async () => {
    const path = fileURLToPath(new URL("../../../../.github/workflows/ci.yaml", import.meta.url));
    const workflow = parse(await readFile(path, "utf8")) as { jobs: Record<string, { steps: { "name"?: string; "run"?: string; "continue-on-error"?: boolean }[] }> };
    const steps = workflow.jobs.validate!.steps;
    for (const [name, task] of [["Run tests", "test"], ["Run type checking", "types"], ["Run linting", "lint"], ["Run Knip analysis", "knip"]]) {
        const step = steps.find(step => step.name === name);
        expect(step?.run).toContain(`--tasks ${task}`);
        expect(step?.["continue-on-error"]).toBeUndefined();
        expect(step?.run).not.toContain("lint:fix");
    }
    expect(steps.find(step => step.name === "moirai import-boundary gate")?.run).toContain("@moirai/db");
    expect(workflow.jobs["moirai-clone-gate"]?.steps.at(-1)?.run).toContain("gate:clone");
});
