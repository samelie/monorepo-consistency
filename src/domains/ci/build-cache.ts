import type { PackageInfo } from "../../types/index";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { captureCommand } from "./process";

// build outputs restored from cache; tracked files under them are keyed by the same tree hashes, so a restore never diverges
const outputDirs = ["dist", "build", "hooks/dist", "hooks/generated"];
const markerDir = "node_modules/.cache/ci-build";

export interface BuildCacheEntry {
    name: string;
    // null: always rebuild (dirty tree, or output written outside the package such as prisma's generated client)
    key: string | null;
    dir: string;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const markerOf = (root: string, name: string) => join(root, markerDir, `${name.replace(/[^\w.-]+/g, "_")}.key`);

const workspaceClosure = (name: string, byName: ReadonlyMap<string, PackageInfo>) => {
    // set iteration visits additions, so this walks the whole workspace dependency closure once
    const closure = new Set([name]);
    for (const member of closure) {
        const pkg = byName.get(member)!;
        for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) {
            if (byName.has(dependency)) closure.add(dependency);
        }
    }
    return closure;
};

// key = lockfile + node major + build script + git tree of the package and every workspace package it depends on
export const buildCacheEntries = async (root: string, packages: readonly PackageInfo[], names: readonly string[]): Promise<BuildCacheEntry[]> => {
    const workspaceRoot = resolve(root);
    // the workspace root's tree covers everything, so it would invalidate every key on any change
    const byName = new Map(packages.filter(pkg => resolve(pkg.path) !== workspaceRoot).map(pkg => [pkg.name, pkg]));
    const lockHash = sha256(await readFile(join(root, "pnpm-lock.yaml"), "utf8"));
    const rel = (pkg: PackageInfo) => relative(root, pkg.path).split("\\").join("/");
    return Promise.all(names.map(async (name): Promise<BuildCacheEntry> => {
        const pkg = byName.get(name);
        if (!pkg) throw new Error(`Unknown build package: ${name}`);
        const script = pkg.scripts?.build ?? "";
        if (script.includes("prisma generate")) return { name, key: null, dir: rel(pkg) };
        const paths = [...workspaceClosure(name, byName)].map(member => rel(byName.get(member)!)).sort();
        if ((await captureCommand("git", ["status", "--porcelain", "--", ...paths], root)).trim() !== "") return { name, key: null, dir: rel(pkg) };
        const trees = (await captureCommand("git", ["rev-parse", ...paths.map(path => `HEAD:${path}`)], root)).trim().split("\n");
        const node = process.versions.node.split(".")[0];
        return { name, key: sha256([name, script, node, lockHash, ...paths.map((path, index) => `${path}=${trees[index]}`)].join("\n")), dir: rel(pkg) };
    }));
};

// the path list is the same for every shard and run (actions/cache only restores entries saved with an
// identical list), so any shard can restore the latest entry; the key covers just this shard's builds and
// per-package markers decide reuse, which makes outputs restored for packages a shard never builds inert
export const buildCacheManifest = (entries: readonly BuildCacheEntry[], os: string, cacheable: readonly PackageInfo[], root: string) => {
    const keyed = entries.filter(entry => entry.key !== null);
    if (keyed.length === 0) return { key: "", paths: [] as string[] };
    const dirs = cacheable
        .filter(pkg => !(pkg.scripts?.build ?? "").includes("prisma generate"))
        .map(pkg => relative(root, pkg.path).split("\\").join("/"))
        .sort();
    return {
        key: `ci-build-${os}-${sha256(keyed.map(entry => `${entry.name}=${entry.key}`).join("\n")).slice(0, 32)}`,
        paths: [...dirs.flatMap(dir => outputDirs.map(output => `${dir}/${output}`)), markerDir],
    };
};

export const isBuildCached = async (root: string, entry: BuildCacheEntry) => {
    if (!entry.key || !existsSync(markerOf(root, entry.name))) return false;
    return (await readFile(markerOf(root, entry.name), "utf8")).trim() === entry.key
        && outputDirs.some(dir => existsSync(join(root, entry.dir, dir)));
};

// drop stale restored outputs before a rebuild; -X removes only ignored files, never tracked ones
export const cleanBuildOutputs = async (root: string, entry: BuildCacheEntry) => {
    const present = outputDirs.map(dir => `${entry.dir}/${dir}`).filter(path => existsSync(join(root, path)));
    if (present.length > 0) await captureCommand("git", ["clean", "-fdXq", "--", ...present], root);
};

export const markBuilt = async (root: string, entry: BuildCacheEntry) => {
    if (!entry.key) return;
    await mkdir(join(root, markerDir), { recursive: true });
    await writeFile(markerOf(root, entry.name), `${entry.key}\n`);
};
