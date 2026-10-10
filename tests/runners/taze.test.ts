import type { RawDep, ResolvedDepChange, writePackage } from "taze";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ inventory: vi.fn(), install: vi.fn(), resolve: vi.fn(), beforeWrite: vi.fn() }));
vi.mock("node:child_process", async importOriginal => {
    const original = await importOriginal<Record<string, unknown>>();
    const execute = Object.assign(vi.fn(), { [promisify.custom]: mocks.inventory });
    return { ...original, execFile: execute, spawn: mocks.install };
});
vi.mock("taze", async importOriginal => {
    const original = await importOriginal<Record<string, unknown>>();
    return {
        ...original,
        resolveDependencies: mocks.resolve,
        writePackage: async (...args: Parameters<typeof writePackage>) => {
            await mocks.beforeWrite(...args);
            return (original.writePackage as typeof writePackage)(...args);
        },
    };
});

const { runTaze } = await import("../../src/runners/taze");

let cwd: string;
const manifest = (name: string) => ({
    name,
    dependencies: { fixed: "1.0.0", local: "workspace:*" },
    devDependencies: { tool: "^1.0.0" },
    optionalDependencies: { optional: "^1.0.0" },
    peerDependencies: { peer: "^1.0.0" },
});

beforeEach(async () => {
    vi.clearAllMocks();
    cwd = await mkdtemp(join(tmpdir(), "mono-upgrade-"));
    await mkdir(join(cwd, "member"));
    await mkdir(join(cwd, "excluded"));
    await Promise.all(["", "member", "excluded"].map(dir => writeFile(join(cwd, dir, "package.json"), JSON.stringify(manifest(dir || "root")))));
    mocks.inventory.mockResolvedValue({ stdout: JSON.stringify([{ path: join(cwd, "member") }]) });
    mocks.install.mockImplementation(() => {
        const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
        queueMicrotask(() => child.emit("close", 0, null));
        return child;
    });
    mocks.resolve.mockImplementation(async (deps: RawDep[]) => deps.map((dep): ResolvedDepChange => ({
        ...dep,
        targetVersion: dep.currentVersion === "workspace:*" ? dep.currentVersion : "2.0.0",
        update: dep.currentVersion !== "workspace:*",
        diff: dep.currentVersion === "workspace:*" ? null : "major",
        pkgData: { tags: { latest: "2.0.0" }, versions: ["1.0.0", "2.0.0"] },
        provenanceDowngraded: false,
    })));
});

afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
});

describe("workspace dependency upgrades", () => {
    it("loads root and exact members, updates all dependency fields, installs once", async () => {
        const excluded = await readFile(join(cwd, "excluded/package.json"), "utf8");
        await runTaze({ cwd, mode: "latest", write: true, install: true, includeLocked: true, peer: true, report: join(cwd, "report.json") });
        const report = JSON.parse(await readFile(join(cwd, "report.json"), "utf8"));
        expect(report).toMatchObject({ outcome: "success", applied: true, installation: { attempted: true, succeeded: true, failed: false } });
        expect(report.manifestsWritten).toEqual(["package.json", "member/package.json"]);
        expect(report.appliedChanges).toHaveLength(8);
        for (const dir of ["", "member"]) {
            const pkg = JSON.parse(await readFile(join(cwd, dir, "package.json"), "utf8"));
            expect(pkg.dependencies).toEqual({ fixed: "2.0.0", local: "workspace:*" });
            expect(pkg.devDependencies.tool).toBe("2.0.0");
            expect(pkg.optionalDependencies.optional).toBe("2.0.0");
            expect(pkg.peerDependencies.peer).toBe("2.0.0");
        }
        expect(await readFile(join(cwd, "excluded/package.json"), "utf8")).toBe(excluded);
        expect(mocks.install).toHaveBeenCalledExactlyOnceWith("pnpm", ["--filter", "*", "install", "--no-frozen-lockfile"], { cwd, stdio: ["inherit", "pipe", "pipe"] });
        expect(mocks.resolve.mock.calls[0]![0]).toHaveLength(5);
    });

    it("skips pnpmfile hooks only when the workspace explicitly opts in", async () => {
        await runTaze({ cwd, write: true, install: true, config: { ignorePnpmfile: true } });
        expect(mocks.install).toHaveBeenCalledExactlyOnceWith("pnpm", ["--filter", "*", "install", "--no-frozen-lockfile", "--ignore-pnpmfile"], { cwd, stdio: ["inherit", "pipe", "pipe"] });
    });

    it("resolves preview without writing or installing despite inherited config", async () => {
        await writeFile(join(cwd, "taze.mjs"), "export default {write: true, install: true}");
        await writeFile(join(cwd, "pnpm-lock.yaml"), "unchanged\n");
        const before = await readFile(join(cwd, "package.json"), "utf8");
        await runTaze({ cwd, config: { configPath: "taze.mjs" }, dryRun: true, peer: true, report: join(cwd, "report.json") });
        expect(mocks.resolve).toHaveBeenCalledOnce();
        expect(await readFile(join(cwd, "package.json"), "utf8")).toBe(before);
        expect(await readFile(join(cwd, "pnpm-lock.yaml"), "utf8")).toBe("unchanged\n");
        expect(mocks.install).not.toHaveBeenCalled();
        const report = JSON.parse(await readFile(join(cwd, "report.json"), "utf8"));
        expect(report).toMatchObject({ outcome: "preview", applied: false, manifestsWritten: [], appliedChanges: [], installation: { attempted: false } });
        expect(report.proposedChanges.length).toBeGreaterThan(0);
    });

    it("propagates install failure after manifest writes", async () => {
        mocks.install.mockImplementation(() => {
            const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
            queueMicrotask(() => child.emit("close", 7, null));
            return child;
        });
        await expect(runTaze({ cwd, write: true, install: true, report: join(cwd, "report.json") })).rejects.toThrow("Workspace install failed (7)");
        const report = JSON.parse(await readFile(join(cwd, "report.json"), "utf8"));
        expect(report).toMatchObject({ outcome: "failed", applied: true, installFailed: true, installation: { attempted: true, succeeded: false, failed: true } });
        expect(report.manifestsWritten).toHaveLength(2);
        expect(report.appliedChanges).toHaveLength(6);
    });

    it("preserves named channels while resolving their registry metadata", async () => {
        await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "root", dependencies: { tagged: "beta" } }));
        mocks.resolve.mockImplementation(async (deps: RawDep[], options: { mode?: string }) => deps.map(dep => ({
            ...dep, targetVersion: dep.currentVersion, update: false,
            diff: dep.name === "tagged" && options.mode === "major" ? "error" : null,
            resolveError: dep.name === "tagged" && options.mode === "major" ? "invalid_range" : undefined,
            pkgData: { tags: { beta: "2.0.0-beta.1", latest: "1.0.0" }, versions: ["1.0.0", "2.0.0-beta.1"] },
        })));
        const packages = await runTaze({ cwd, mode: "major", write: true });
        expect(packages.find(pkg => pkg.name === "root")?.resolved[0]?.resolveError).toBeUndefined();
        expect(JSON.parse(await readFile(join(cwd, "package.json"), "utf8")).dependencies.tagged).toBe("beta");
        expect(mocks.resolve).toHaveBeenCalledTimes(2);
    });

    it("rejects a new prerelease even when the registry tags it latest", async () => {
        const before = await readFile(join(cwd, "package.json"), "utf8");
        mocks.resolve.mockImplementation(async (deps: RawDep[]) => deps.map(dep => ({
            ...dep, targetVersion: "3.0.0-rc.1", update: true, diff: "major",
            pkgData: { tags: { latest: "3.0.0-rc.1" }, versions: ["3.0.0-rc.1"] },
        })));
        await expect(runTaze({ cwd, mode: "major", write: true, install: true, report: join(cwd, "report.json") })).rejects.toThrow("Refusing new prerelease");
        expect(await readFile(join(cwd, "package.json"), "utf8")).toBe(before);
        expect(mocks.install).not.toHaveBeenCalled();
        const report = JSON.parse(await readFile(join(cwd, "report.json"), "utf8"));
        expect(report).toMatchObject({ outcome: "failed", applied: false, manifestsWritten: [], appliedChanges: [], installation: { attempted: false } });
    });

    it("propagates registry failures before any manifest writes", async () => {
        const before = await readFile(join(cwd, "package.json"), "utf8");
        mocks.resolve.mockImplementation(async (deps: RawDep[]) => deps.map(dep => ({
            ...dep, targetVersion: dep.currentVersion,
            update: false, diff: "error", resolveError: "registry unavailable", pkgData: { tags: {}, versions: [] },
        })));
        await expect(runTaze({ cwd, write: true, install: true, report: join(cwd, "report.json") })).rejects.toThrow("registry unavailable");
        expect(await readFile(join(cwd, "package.json"), "utf8")).toBe(before);
        expect(mocks.install).not.toHaveBeenCalled();
        const report = JSON.parse(await readFile(join(cwd, "report.json"), "utf8"));
        expect(report).toMatchObject({ outcome: "failed", applied: false, manifestsWritten: [], appliedChanges: [], installation: { attempted: false } });
    });
    it("reports retained downgrades without claiming writes", async () => {
        mocks.resolve.mockImplementation(async (deps: RawDep[]) => deps.map(dep => ({
            ...dep, targetVersion: "0.9.0", update: false, diff: "error",
            pkgData: { tags: { latest: "0.9.0" }, versions: ["0.9.0"] },
        })));
        await runTaze({ cwd, write: true, report: join(cwd, "report.json") });
        const report = JSON.parse(await readFile(join(cwd, "report.json"), "utf8"));
        expect(report).toMatchObject({ outcome: "success", applied: false, manifestsWritten: [], appliedChanges: [], proposedChanges: [] });
        expect(report.packages[0].dependencies[0].exception).toContain("newer declaration retained");
    });
    it("reports only completed manifest writes when a later write fails", async () => {
        mocks.beforeWrite.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("write failed"));
        await expect(runTaze({ cwd, write: true, install: true, report: join(cwd, "report.json") })).rejects.toThrow("write failed");
        const report = JSON.parse(await readFile(join(cwd, "report.json"), "utf8"));
        expect(report).toMatchObject({ outcome: "failed", applied: true, manifestsWritten: ["package.json"], manifestsWrittenCount: 1, installation: { attempted: false } });
        expect(report.appliedChanges.every((change: { manifest: string }) => change.manifest === "package.json")).toBe(true);
        expect(report.proposedChanges.length).toBeGreaterThan(report.appliedChanges.length);
        expect(mocks.install).not.toHaveBeenCalled();
    });

    it("reports a thrown registry error without hiding the original failure", async () => {
        mocks.resolve.mockRejectedValueOnce(new Error("registry transport failed"));
        await expect(runTaze({ cwd, write: true, report: join(cwd, "report.json") })).rejects.toThrow("registry transport failed");
        const report = JSON.parse(await readFile(join(cwd, "report.json"), "utf8"));
        expect(report).toMatchObject({ outcome: "failed", applied: false, manifestsWrittenCount: 0, appliedChanges: [], installation: { attempted: false } });
        expect(report.error).toContain("registry transport failed");
    });
});
