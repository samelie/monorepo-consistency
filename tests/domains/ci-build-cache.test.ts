import type { PackageInfo } from "../../src/types/index";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCacheEntries, buildCacheManifest, cleanBuildOutputs, isBuildCached, markBuilt } from "../../src/domains/ci/build-cache";

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=ci@test", "-c", "user.name=ci", ...args], { cwd: dir, stdio: "pipe" });

describe("ci prerequisite build cache", () => {
    let dir: string;
    const pkg = (name: string, scripts: Record<string, string>, dependencies: Record<string, string> = {}): PackageInfo =>
        ({ name, path: join(dir, name), version: "1", private: true, scripts, dependencies });
    let packages: PackageInfo[];

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "ci-build-cache-"));
        packages = [
            pkg("root", {}),
            pkg("a", { build: "tsup" }),
            pkg("b", { build: "unbuild" }, { a: "workspace:*" }),
            pkg("p", { build: "prisma generate && tsc" }),
        ];
        packages[0]!.path = dir;
        for (const name of ["a", "b", "p"]) {
            await mkdir(join(dir, name), { recursive: true });
            await writeFile(join(dir, name, "index.ts"), `export const ${name} = 1;\n`);
        }
        await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
        await writeFile(join(dir, ".gitignore"), "dist/\nnode_modules/\n");
        git(dir, "init", "-q");
        git(dir, "add", ".");
        git(dir, "commit", "-qm", "init");
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    const keys = async () => Object.fromEntries((await buildCacheEntries(dir, packages, ["a", "b", "p"])).map(entry => [entry.name, entry.key]));

    it("keys each package by its own and its workspace dependencies' trees, never prisma builds", async () => {
        const first = await keys();
        expect(first.a).toMatch(/^[a-f0-9]{64}$/);
        expect(first.b).not.toBe(first.a);
        expect(first.p).toBeNull();
        await writeFile(join(dir, "b", "index.ts"), "export const b = 2;\n");
        git(dir, "commit", "-qam", "b only");
        const second = await keys();
        expect(second.a).toBe(first.a);
        expect(second.b).not.toBe(first.b);
        await writeFile(join(dir, "a", "index.ts"), "export const a = 2;\n");
        git(dir, "commit", "-qam", "a");
        const third = await keys();
        expect(third.a).not.toBe(second.a);
        expect(third.b).not.toBe(second.b);
    });

    it("never caches a package whose closure has uncommitted changes, and the lockfile invalidates everything", async () => {
        const clean = await keys();
        await writeFile(join(dir, "a", "index.ts"), "export const a = 3;\n");
        const dirty = await keys();
        expect(dirty.a).toBeNull();
        expect(dirty.b).toBeNull();
        git(dir, "checkout", "--", "a/index.ts");
        await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.1'\n");
        git(dir, "commit", "-qam", "lock");
        const relocked = await keys();
        expect(relocked.a).not.toBe(clean.a);
    });

    it("reuses output only when the marker matches, and a rebuild clean keeps tracked files", async () => {
        const [a] = await buildCacheEntries(dir, packages, ["a"]);
        expect(await isBuildCached(dir, a!)).toBe(false);
        await mkdir(join(dir, "a", "dist"), { recursive: true });
        await writeFile(join(dir, "a", "dist", "out.js"), "built\n");
        await writeFile(join(dir, "a", "dist", "tracked.txt"), "tracked\n");
        git(dir, "add", "-f", "a/dist/tracked.txt");
        git(dir, "commit", "-qm", "tracked output");
        const [rekeyed] = await buildCacheEntries(dir, packages, ["a"]);
        await markBuilt(dir, rekeyed!);
        expect(await isBuildCached(dir, rekeyed!)).toBe(true);
        expect(await isBuildCached(dir, { ...rekeyed!, key: "0".repeat(64) })).toBe(false);
        await cleanBuildOutputs(dir, rekeyed!);
        expect(existsSync(join(dir, "a", "dist", "out.js"))).toBe(false);
        expect(existsSync(join(dir, "a", "dist", "tracked.txt"))).toBe(true);
    });

    it("emits one stable cache key and the output paths of cacheable packages only", async () => {
        const entries = await buildCacheEntries(dir, packages, ["a", "b", "p"]);
        const manifest = buildCacheManifest(entries, "Linux");
        expect(manifest.key).toMatch(/^ci-build-Linux-[a-f0-9]{32}$/);
        expect(buildCacheManifest(entries, "Linux").key).toBe(manifest.key);
        expect(manifest.paths).toContain("a/dist");
        expect(manifest.paths.some(path => path.startsWith("p/"))).toBe(false);
        expect(buildCacheManifest(entries.filter(entry => entry.name === "p"), "Linux")).toEqual({ key: "", paths: [] });
    });
});
