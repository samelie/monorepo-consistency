import type { PackageInfo, WorkspaceInfo } from "../../src/types/index";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { planCi } from "../../src/domains/ci/planner";
import { ciSchedulingSchema, ciTasks } from "../../src/domains/ci/policy";
import { getWorkspaceInfo, loadPackageJson } from "../../src/utils/workspace";

const pkg = (name: string, path = name): PackageInfo => ({
    name, path: `/repo/${path}`, version: "1", private: true,
    scripts: { test: "vitest run", types: "tsgo", lint: "eslint .", knip: "knip" },
});
const workspace: WorkspaceInfo = {
    root: "/repo", lockfile: "/repo/pnpm-lock.yaml", workspaceFile: "/repo/pnpm-workspace.yaml",
    packages: [
        pkg("owner", "group"), pkg("impacted", "outside/impacted"),
        { ...pkg("dependent"), dependencies: { impacted: "workspace:*" } },
        { ...pkg("dev-dependent"), devDependencies: { dependent: "workspace:*" } },
        { ...pkg("optional-dependent"), optionalDependencies: { "dev-dependent": "workspace:*" } },
        { ...pkg("peer-dependent"), peerDependencies: { "optional-dependent": "*" } },
        pkg("unrelated"), pkg("wrapper"), pkg("child", "wrapper/child"),
    ],
};

describe("declarative CI impacts", () => {
    it("closes impact cycles and genuine consumers across all manifest dependency sections once", () => {
        const policy = ciSchedulingSchema.parse({
            impacts: { "owner": ["impacted", "impacted"], "impacted": ["owner"], "peer-dependent": ["impacted"] },
        });
        const plan = planCi(workspace, policy, ["test", "test"], { affected: ["owner", "owner"], files: [] });
        expect(plan.packages).toEqual(["dependent", "dev-dependent", "impacted", "optional-dependent", "owner", "peer-dependent"]);
        expect(plan.targets.map(target => target.package)).toEqual(plan.packages);
        expect(new Set(plan.targets.map(target => `${target.package}:${target.task}`)).size).toBe(plan.targets.length);
    });

    it("continues closure through newly impacted wrappers and their children's consumers", () => {
        const policy = ciSchedulingSchema.parse({
            impacts: { owner: ["wrapper"], child: ["impacted"] },
            packages: { wrapper: { test: { kind: "children", reason: "actual wrapper" } } },
        });
        const plan = planCi(workspace, policy, ["test"], { affected: ["owner"], files: [] });
        expect(plan.packages).toContain("child");
        expect(plan.packages).toContain("peer-dependent");
        expect(plan.targets.some(target => target.package === "wrapper")).toBe(false);
        expect(plan.wrappers).toEqual([{ package: "wrapper", task: "test", reason: "actual wrapper" }]);
    });

    it("keeps ordinary leaf changes scoped without traversing impact owners or dependencies backwards", () => {
        const policy = ciSchedulingSchema.parse({ impacts: { owner: ["impacted"] } });
        const plan = planCi(workspace, policy, ["test"], { affected: [], files: ["dev-dependent/src/a.ts"] });
        expect(plan.packages).toEqual(["dev-dependent", "optional-dependent", "peer-dependent"]);
        expect(plan.packages).not.toContain("owner");
        expect(plan.packages).not.toContain("impacted");
    });

    it.each([
        { missing: ["impacted"] },
        { owner: ["missing"] },
    ])("rejects unknown impact endpoints before any main or PR selection: %j", impacts => {
        const policy = ciSchedulingSchema.parse({ impacts });
        expect(() => planCi(workspace, policy, ["test"])).toThrow(/CI impact.*unknown package: missing/);
        expect(() => planCi(workspace, policy, ["test"], { affected: ["unrelated"], files: [] })).toThrow(/CI impact.*unknown package: missing/);
    });

    it("accepts omitted impacts and validates the declared record shape", () => {
        expect(ciSchedulingSchema.parse({}).impacts).toBeUndefined();
        expect(ciSchedulingSchema.safeParse({ impacts: { owner: "impacted" } }).success).toBe(false);
        expect(ciSchedulingSchema.safeParse({ impacts: { owner: [""] } }).success).toBe(false);
        expect(ciSchedulingSchema.safeParse({ impacts: { "": ["impacted"] } }).success).toBe(false);
    });

    it("retains optional and peer consumers when loading real manifests", async () => {
        const dir = await mkdtemp(join(tmpdir(), "ci-impact-manifest-"));
        try {
            await writeFile(join(dir, "package.json"), JSON.stringify({
                name: "loaded-consumer", version: "1", scripts: { test: "vitest run" },
                optionalDependencies: { impacted: "workspace:*" }, peerDependencies: { owner: "*" },
            }));
            const loaded = await loadPackageJson(dir);
            for (const affected of ["owner", "impacted"]) {
                const plan = planCi({ ...workspace, packages: [...workspace.packages, loaded] }, ciSchedulingSchema.parse({}), ["test"], { affected: [affected], files: [] });
                expect(plan.targets.filter(target => target.package === "loaded-consumer")).toHaveLength(1);
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe("calendar orchestration on the real workspace inventory", () => {
    const root = resolve(import.meta.dirname, "../../../..");
    const group = [
        "@adddog/mono-cal-sdk", "@mono-cal/capabilities", "@mono-cal/client-harness", "@mono-cal/db",
        "@mono-cal/devkit", "@mono-cal/integrations", "@mono-cal/pulumi", "@mono-cal/trpc",
        "@mono-cal/webui", "mono-cal-agent-worker", "mono-cal-backend", "mono-cal-pi-crawl-worker",
    ].sort();
    let actual: WorkspaceInfo;
    let policy: ReturnType<typeof ciSchedulingSchema.parse>;

    beforeAll(async () => {
        actual = await getWorkspaceInfo(root);
        actual.packages = [...actual.packages, await loadPackageJson(root)];
        const config = JSON.parse(await readFile(resolve(root, "monorepo.config.json"), "utf8"));
        policy = ciSchedulingSchema.parse(config.ci.scheduling);
    });

    it.each(["mono-cal/package.json", "mono-cal/scripts/e2e-stack.sh", "mono-cal/monorepo.config.json"])("selects the calendar group for %s with its real root check and full backend profile", file => {
        const plan = planCi(actual, policy, ciTasks, { affected: ["@mono-cal/root"], files: [file] });
        expect(policy.impacts?.["@mono-cal/root"]?.slice().sort()).toEqual(group);
        expect(plan.packages).toEqual(["@mono-cal/root", ...group].sort());
        expect(plan.concurrency).toBe(2);
        expect(plan.targets.filter(target => target.package === "@mono-cal/root")).toEqual([
            { package: "@mono-cal/root", task: "knip", command: "pnpm", args: ["--filter", "@mono-cal/root", "run", "knip"] },
        ]);
        expect(plan.targets.filter(target => target.package === "mono-cal-backend" && target.task === "test")).toEqual([
            { package: "mono-cal-backend", task: "test", command: "pnpm", args: ["--filter", "mono-cal-backend", "run", "test:ci"] },
        ]);
        expect(new Set(plan.targets.map(target => `${target.package}:${target.task}`)).size).toBe(plan.targets.length);
        for (const name of group) {
            const tasks = name === "@mono-cal/webui" ? ["types", "lint", "knip"] : ciTasks;
            expect(plan.targets.filter(target => target.package === name).map(target => target.task)).toEqual(tasks);
        }
        expect(plan.wrappers.some(target => target.package === "@mono-cal/root")).toBe(false);
    });

    it("keeps a real devkit leaf change from expanding its orchestration siblings", () => {
        const plan = planCi(actual, policy, ciTasks, { affected: ["@mono-cal/devkit"], files: ["packages/mono-cal-devkit/src/paths.ts"] });
        expect(plan.packages).toEqual(["@mono-cal/devkit"]);
        expect(plan.targets.map(target => target.task)).toEqual(ciTasks);
    });
});
