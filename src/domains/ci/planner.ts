import type { PackageInfo, WorkspaceInfo } from "../../types/index";
import type { CiRequirement, CiScheduling, CiTask } from "./policy";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { minimatch } from "minimatch";
import { z } from "zod/v4";
import { getWorkspaceInfo, loadPackageJson } from "../../utils/workspace";
import { ciRequirements, ciTasks } from "./policy";
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
    timeoutMinutes: number;
    shards: number;
    packages: string[];
    targets: CiTarget[];
    omitted: { package: string; task: CiTask; reason: string }[];
    placeholders: { package: string; task: CiTask; script: string }[];
    requires: Record<string, CiRequirement[]>;
    // build.orderedPackages entries each package needs before its checks, in build order
    builds: Record<string, string[]>;
    // estimated seconds per executable `package:task`, from the last measured run where available
    seconds: Record<string, number>;
}

export const ciPlanSchema = z.object({
    reason: z.string(),
    concurrency: z.number().int().min(1).max(16),
    timeoutMinutes: z.number().int().min(1).max(120),
    shards: z.number().int().min(1).max(16),
    packages: z.array(z.string()),
    targets: z.array(z.object({ package: z.string(), task: z.enum(ciTasks), command: z.string().min(1), args: z.array(z.string()) })),
    omitted: z.array(z.object({ package: z.string(), task: z.enum(ciTasks), reason: z.string() })),
    placeholders: z.array(z.object({ package: z.string(), task: z.enum(ciTasks), script: z.string() })),
    requires: z.record(z.string(), z.array(z.enum(ciRequirements))),
    builds: z.record(z.string(), z.array(z.string())),
    seconds: z.record(z.string(), z.number().nonnegative()),
}).refine(plan => new Set(plan.targets.map(target => `${target.package}:${target.task}`)).size === plan.targets.length, "Duplicate CI target");

const containsPath = (parent: string, child: string) => child === parent || child.startsWith(`${parent}/`);
const packagePath = (workspace: WorkspaceInfo, pkg: PackageInfo) => relative(workspace.root, pkg.path).split("\\").join("/");

// a package whose own manifest pulls a playwright driver runs its tests against a real browser
const browserDrivers = ["playwright", "playwright-core", "@playwright/test", "@playwright/mcp", "@vitest/browser", "@vitest/browser-playwright"];
const inferRequires = (pkg: PackageInfo): CiRequirement[] => {
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
    return browserDrivers.some(name => name in dependencies) ? ["chromium"] : [];
};

// per-target seconds when a task has no measurement at all (full-run medians, 2026-11-07)
const defaultSeconds: Record<CiTask, number> = { types: 4, lint: 7, knip: 4, test: 15 };
const targetKey = (target: Pick<CiTarget, "package" | "task">) => `${target.package}:${target.task}`;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const isPlaceholder = (plan: CiPlan, target: CiTarget) =>
    plan.placeholders.some(entry => entry.package === target.package && entry.task === target.task);
export const executableTargets = (plan: CiPlan) => plan.targets.filter(target => !isPlaceholder(plan, target));

// longest-first greedy over whole packages: deterministic, so every shard derives the same split
const assignShards = (plan: CiPlan): Map<string, number> => {
    const weights = new Map<string, number>();
    for (const target of executableTargets(plan)) weights.set(target.package, (weights.get(target.package) ?? 0) + (plan.seconds[targetKey(target)] ?? defaultSeconds[target.task]));
    const loads: number[] = Array.from({ length: plan.shards }).fill(0) as number[];
    const assignment = new Map<string, number>();
    for (const [name, weight] of [...weights].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        const shard = loads.indexOf(Math.min(...loads));
        loads[shard]! += weight;
        assignment.set(name, shard + 1);
    }
    return assignment;
};

export const selectShard = (plan: CiPlan, shard: number, of: number): CiPlan => {
    if (of !== plan.shards || !Number.isInteger(shard) || shard < 1 || shard > of) throw new Error(`Invalid shard ${shard}/${of} for a ${plan.shards}-shard plan`);
    const assignment = assignShards(plan);
    // packages without executable targets carry only report entries, kept on the first shard
    const owned = (name: string) => (assignment.get(name) ?? 1) === shard;
    return {
        ...plan,
        packages: plan.packages.filter(owned),
        targets: executableTargets(plan).filter(target => owned(target.package)),
        omitted: plan.omitted.filter(target => owned(target.package)),
        placeholders: plan.placeholders.filter(target => owned(target.package)),
        requires: Object.fromEntries(Object.entries(plan.requires).filter(([name]) => owned(name))),
        builds: Object.fromEntries(Object.entries(plan.builds).filter(([name]) => owned(name))),
        seconds: Object.fromEntries(Object.entries(plan.seconds).filter(([key]) => owned(key.slice(0, key.lastIndexOf(":"))))),
    };
};

// union of the selected packages' prerequisite builds, kept in configured build order
export const shardBuilds = (plan: CiPlan, buildOrder: readonly string[]): string[] => {
    const needed = new Set(plan.packages.flatMap(name => plan.builds[name] ?? []));
    return buildOrder.filter(name => needed.has(name));
};

// requirements only matter where a test target will execute
export const shardRequirements = (plan: CiPlan): CiRequirement[] => {
    const tested = new Set(executableTargets(plan).filter(target => target.task === "test").map(target => target.package));
    return ciRequirements.filter(requirement => Object.entries(plan.requires).some(([name, list]) => tested.has(name) && list.includes(requirement)));
};

export const planCi = (
    workspace: WorkspaceInfo,
    policy: CiScheduling,
    tasks: readonly CiTask[],
    selection?: { affected: readonly string[]; files: readonly string[] },
    buildOrder: readonly string[] = [],
    durations: Readonly<Record<string, number>> = {},
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
    for (const [owner, targets] of Object.entries(policy.impacts ?? {})) {
        if (!byName.has(owner)) throw new Error(`CI impact owner names unknown package: ${owner}`);
        for (const target of targets) {
            if (!byName.has(target)) throw new Error(`CI impact target names unknown package: ${target}`);
        }
    }
    for (const name of Object.keys(policy.requires ?? {})) {
        if (!byName.has(name)) throw new Error(`CI requires names unknown package: ${name}`);
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
        const dependents = new Map<string, Set<string>>();
        for (const pkg of workspace.packages) {
            const dependencies = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
            for (const dependency of Object.keys(dependencies)) {
                if (!byName.has(dependency)) continue;
                const consumers = dependents.get(dependency) ?? new Set<string>();
                consumers.add(pkg.name);
                dependents.set(dependency, consumers);
            }
        }
        // set iteration visits additions, closing coverage and consumer edges once even with cycles
        for (const name of selected) {
            for (const target of policy.impacts?.[name] ?? []) selected.add(target);
            for (const dependent of dependents.get(name) ?? []) selected.add(dependent);
            const pkg = byName.get(name)!;
            if (!Object.values(policy.packages[name] ?? {}).some(rule => rule?.kind === "children")) continue;
            const parent = packagePath(workspace, pkg);
            for (const child of workspace.packages) if (parent === "" || containsPath(parent, packagePath(workspace, child))) selected.add(child.name);
        }
    }
    const plan: CiPlan = {
        reason: expandAll ? (selection ? "shared configuration change" : "all workspace packages") : "changed packages and dependents",
        concurrency: policy.concurrency,
        timeoutMinutes: policy.timeoutMinutes,
        shards: 1,
        packages: [...selected].sort(),
        targets: [],
        omitted: [],
        placeholders: [],
        requires: {},
        builds: {},
        seconds: {},
    };
    const workspaceDependencies = (pkg: PackageInfo) =>
        Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }).filter(name => byName.has(name));
    for (const name of plan.packages) {
        const pkg = byName.get(name)!;
        // set iteration visits additions, so this walks the whole workspace dependency closure once
        const closure = new Set([name]);
        for (const member of closure) for (const dependency of workspaceDependencies(byName.get(member)!)) closure.add(dependency);
        const builds = buildOrder.filter(entry => closure.has(entry));
        if (builds.length > 0) plan.builds[name] = builds;
        const requires = ciRequirements.filter(requirement => [...inferRequires(pkg), ...(policy.requires?.[name] ?? [])].includes(requirement));
        if (requires.length > 0) plan.requires[name] = requires;
        for (const task of new Set(tasks)) {
            const rule = policy.packages[name]?.[task];
            if (rule?.kind === "children" || rule?.kind === "skip") {
                plan.omitted.push({ package: name, task, reason: rule.reason });
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
    // unmeasured targets take their task's median measured duration, so new packages are never free
    const estimates = Object.fromEntries(ciTasks.map(task => {
        const measured = Object.entries(durations)
            .filter(([key, value]) => key.endsWith(`:${task}`) && Number.isFinite(value) && value >= 0)
            .map(([, value]) => value);
        return [task, measured.length > 0 ? median(measured) : defaultSeconds[task]];
    })) as Record<CiTask, number>;
    for (const target of executableTargets(plan)) plan.seconds[targetKey(target)] = durations[targetKey(target)] ?? estimates[target.task];
    const total = Object.values(plan.seconds).reduce((sum, value) => sum + value, 0);
    plan.shards = Math.min(policy.maxShards, Math.max(1, Math.ceil(total / policy.shardSeconds)));
    return plan;
};

const parseList = (text: string) => z.array(z.object({ name: z.string().min(1), path: z.string().min(1) })).parse(JSON.parse(text));

export const collectCiPlan = async (
    cwd: string,
    policy: CiScheduling,
    tasks: readonly CiTask[],
    base?: string,
    buildOrder: readonly string[] = [],
    durations: Readonly<Record<string, number>> = {},
): Promise<CiPlan> => {
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
    if (!base) return planCi(workspace, policy, tasks, undefined, buildOrder, durations);
    if (base.startsWith("-") || !base.trim()) throw new Error("Invalid CI base ref");
    await captureCommand("git", ["rev-parse", "--verify", `${base}^{commit}`], workspace.root);
    const affected = parseList(await captureCommand("pnpm", ["--filter", `...[${base}]`, "list", "--depth=-1", "--json"], workspace.root));
    const files = (await captureCommand("git", ["diff", "--name-only", "-z", `${base}...HEAD`, "--"], workspace.root)).split("\0").filter(Boolean);
    return planCi(workspace, policy, tasks, { affected: affected.map(pkg => pkg.name), files }, buildOrder, durations);
};
