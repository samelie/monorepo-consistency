import type { PackageInfo, WorkspaceInfo } from "../../types/index";
import type { CiScheduling, CiTask } from "./policy";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { minimatch } from "minimatch";
import { z } from "zod/v4";
import { getWorkspaceInfo, loadPackageJson } from "../../utils/workspace";
import { ciTasks } from "./policy";
import { captureCommand } from "./process";

export interface CiTarget {
    package: string;
    task: CiTask;
    command: string;
    args: string[];
}

export interface CiPlan {
    reason: string;
    concurrency: number;
    packages: string[];
    targets: CiTarget[];
    wrappers: { package: string; task: CiTask; reason: string }[];
    placeholders: { package: string; task: CiTask; script: string }[];
}

export const ciPlanSchema = z.object({
    reason: z.string(),
    concurrency: z.number().int().min(1).max(16),
    packages: z.array(z.string()),
    targets: z.array(z.object({ package: z.string(), task: z.enum(ciTasks), command: z.string().min(1), args: z.array(z.string()) })),
    wrappers: z.array(z.object({ package: z.string(), task: z.enum(ciTasks), reason: z.string() })),
    placeholders: z.array(z.object({ package: z.string(), task: z.enum(ciTasks), script: z.string() })),
}).refine(plan => new Set(plan.targets.map(target => `${target.package}:${target.task}`)).size === plan.targets.length, "Duplicate CI target");

const containsPath = (parent: string, child: string) => child === parent || child.startsWith(`${parent}/`);
const packagePath = (workspace: WorkspaceInfo, pkg: PackageInfo) => relative(workspace.root, pkg.path).split("\\").join("/");

export const planCi = (
    workspace: WorkspaceInfo,
    policy: CiScheduling,
    tasks: readonly CiTask[],
    selection?: { affected: readonly string[]; files: readonly string[] },
): CiPlan => {
    if (!Number.isInteger(policy.concurrency) || policy.concurrency < 1 || policy.concurrency > 16) {
        throw new Error("CI concurrency must be an integer between 1 and 16");
    }
    const byName = new Map<string, PackageInfo>();
    for (const pkg of workspace.packages) {
        if (!pkg.name || byName.has(pkg.name)) throw new Error(`Invalid or duplicate workspace package: ${pkg.name}`);
        byName.set(pkg.name, pkg);
    }
    for (const [name, rules] of Object.entries(policy.packages)) {
        const pkg = byName.get(name);
        if (!pkg) throw new Error(`CI policy names unknown package: ${name}`);
        for (const [task, rule] of Object.entries(rules)) {
            if (rule?.kind === "script" && !pkg.scripts?.[rule.script]) {
                throw new Error(`Missing CI script ${name}:${task} -> ${rule.script}`);
            }
        }
    }
    const expandAll = !selection || selection.files.some(file => policy.allOnChange.some(pattern => minimatch(file, pattern, { dot: true })));
    const selected = new Set(expandAll ? byName.keys() : selection.affected);
    for (const name of selected) if (!byName.has(name)) throw new Error(`Affected selection names unknown package: ${name}`);
    if (selection && !expandAll) {
        for (const file of selection.files) {
            const owner = workspace.packages
                .filter(pkg => containsPath(packagePath(workspace, pkg), file))
                .sort((a, b) => b.path.length - a.path.length)[0];
            if (owner) selected.add(owner.name);
        }
        // an orchestration manifest can own no dependency edge to its children
        for (const name of [...selected]) {
            const pkg = byName.get(name)!;
            if (!Object.values(policy.packages[name] ?? {}).some(rule => rule?.kind === "children")) continue;
            const parent = packagePath(workspace, pkg);
            for (const child of workspace.packages) if (parent === "" || containsPath(parent, packagePath(workspace, child))) selected.add(child.name);
        }
    }
    const plan: CiPlan = {
        reason: expandAll ? (selection ? "shared configuration change" : "all workspace packages") : "changed packages and dependents",
        concurrency: policy.concurrency,
        packages: [...selected].sort(),
        targets: [],
        wrappers: [],
        placeholders: [],
    };
    for (const name of plan.packages) {
        const pkg = byName.get(name)!;
        for (const task of new Set(tasks)) {
            const rule = policy.packages[name]?.[task];
            if (rule?.kind === "children") {
                plan.wrappers.push({ package: name, task, reason: rule.reason });
                continue;
            }
            const script = rule?.kind === "script" ? rule.script : task;
            if (!rule && !pkg.scripts?.[script]) continue;
            if (rule?.kind !== "command" && /^echo\s/.test(pkg.scripts?.[script] ?? "")) {
                plan.placeholders.push({ package: name, task, script: pkg.scripts![script]! });
            }
            plan.targets.push(rule?.kind === "command"
                ? { package: name, task, command: rule.command, args: [...rule.args] }
                : { package: name, task, command: "pnpm", args: ["--filter", name, "run", script] });
        }
    }
    return plan;
};

const parseList = (text: string) => z.array(z.object({ name: z.string().min(1), path: z.string().min(1) })).parse(JSON.parse(text));

export const collectCiPlan = async (cwd: string, policy: CiScheduling, tasks: readonly CiTask[], base?: string): Promise<CiPlan> => {
    const workspace = await getWorkspaceInfo(cwd);
    const all = parseList(await captureCommand("pnpm", ["-r", "list", "--depth=-1", "--json"], workspace.root));
    const rootPackage = await loadPackageJson(workspace.root);
    workspace.packages = [...workspace.packages.filter(pkg => resolve(pkg.path) !== workspace.root), rootPackage];
    const paths = new Set(workspace.packages.map(pkg => resolve(pkg.path)));
    if (all.length !== paths.size || all.some(pkg => !paths.has(resolve(pkg.path)))) {
        throw new Error("Workspace collector and pnpm disagree; refusing incomplete CI inventory");
    }
    // re-read every manifest so a collector warning cannot silently remove a check
    await Promise.all(all.map(async pkg => JSON.parse(await readFile(join(pkg.path, "package.json"), "utf8"))));
    if (!base) return planCi(workspace, policy, tasks);
    if (base.startsWith("-") || !base.trim()) throw new Error("Invalid CI base ref");
    await captureCommand("git", ["rev-parse", "--verify", `${base}^{commit}`], workspace.root);
    const affected = parseList(await captureCommand("pnpm", ["--filter", `...[${base}]`, "list", "--depth=-1", "--json"], workspace.root));
    const files = (await captureCommand("git", ["diff", "--name-only", "-z", `${base}...HEAD`, "--"], workspace.root)).split("\0").filter(Boolean);
    return planCi(workspace, policy, tasks, { affected: affected.map(pkg => pkg.name), files });
};
