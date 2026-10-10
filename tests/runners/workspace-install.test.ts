import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
const { installWorkspace } = await import("../../src/runners/workspace-install");

interface Attempt {
    code?: number;
    signal?: NodeJS.Signals;
    stdout?: string[];
    stderr?: string[];
    error?: Error;
}

const missing = (name = "playwright-core") => `Error: ERR_PNPM_NO_MATCHING_VERSION

  × installing dependencies
  ╰─▶ Failed to resolve dependency tree: No matching version found for
      ${name}@1.64.0-alpha-1790635538000 while fetching it from
      https://registry.npmjs.org/
  help: The latest release of ${name} is "1.63.0".
`;
let attempts: Attempt[];

beforeEach(() => {
    attempts = [];
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    mocks.spawn.mockReset().mockImplementation(() => {
        const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
        const attempt = attempts.shift() || {};
        queueMicrotask(() => {
            for (const chunk of attempt.stdout || []) child.stdout.emit("data", Buffer.from(chunk));
            for (const chunk of attempt.stderr || []) child.stderr.emit("data", Buffer.from(chunk));
            if (attempt.error) child.emit("error", attempt.error);
            else child.emit("close", attempt.signal ? null : (attempt.code ?? 0), attempt.signal || null);
        });
        return child;
    });
});

afterEach(() => vi.restoreAllMocks());

describe("workspace install recovery", () => {
    it.each(["playwright-core", "@typescript-eslint/project-service"])("refreshes only %s and retries once", async name => {
        const diagnostic = missing(name);
        attempts = [{ code: 1, stdout: ["progress\n"], stderr: [diagnostic.slice(0, 55), diagnostic.slice(55)] }, {}, {}];
        await installWorkspace("/workspace", true);
        expect(mocks.spawn.mock.calls.map(call => call[1])).toEqual([
            ["--filter", "*", "install", "--no-frozen-lockfile", "--ignore-pnpmfile"],
            ["--ignore-pnpmfile", "cache", "delete", name],
            ["--filter", "*", "install", "--no-frozen-lockfile", "--ignore-pnpmfile"],
        ]);
        expect(process.stdout.write).toHaveBeenCalledWith(Buffer.from("progress\n"));
        expect(process.stderr.write).toHaveBeenCalledWith(Buffer.from(diagnostic.slice(55)));
    });

    it("recognizes the unwrapped renderer on stdout", async () => {
        attempts = [{ code: 1, stdout: ["ERR_PNPM_NO_MATCHING_VERSION No matching version found for example@2.0.0 while fetching it from https://registry.npmjs.org/\n"] }];
        await installWorkspace("/workspace");
        expect(mocks.spawn.mock.calls[1]?.[1]).toEqual(["cache", "delete", "example"]);
    });

    it.each([
        ["whatwg-url", "whatwg-\n      url"],
        ["@typescript-eslint/project-service", "@typescript-eslint/\n      project-service"],
        ["@typescript-eslint/project-service", "@typescript-\r\n      eslint/project-service"],
    ])("refreshes the complete name when pnpm wraps %s", async (name, wrapped) => {
        const diagnostic = `Error: ERR_PNPM_NO_MATCHING_VERSION

  × installing dependencies
  ╰─▶ Failed to resolve dependency tree: No matching version found for ${wrapped}@^17.2.0 while fetching it from https://registry.npmjs.org/
  help: The latest release is older.
`;
        attempts = [{ code: 1, stderr: [diagnostic] }, {}, {}];
        await installWorkspace("/workspace");
        expect(mocks.spawn.mock.calls.map(call => call[1])).toEqual([
            ["--filter", "*", "install", "--no-frozen-lockfile"],
            ["cache", "delete", name],
            ["--filter", "*", "install", "--no-frozen-lockfile"],
        ]);
    });

    it.each([
        "Error: ERR_PNPM_FETCH_404\nNo matching version found for example@2 while fetching it from https://registry.npmjs.org/",
        missing("*"), missing("@scope/*"), missing("../example"), missing("--all"),
        missing("whatwg url"), missing("whatwg-\nurl"), missing("@scope/\n      *"), missing("../\n      example"), missing("-\n      -all"), missing("a".repeat(215)),
        missing().replace("ERR_PNPM_NO_MATCHING_VERSION", "ERR_PNPM_NO_MATCHING_VERSION_OTHER"),
    ])("propagates unrelated or unsafe diagnostics without retry", async diagnostic => {
        attempts = [{ code: 7, stderr: [diagnostic] }];
        await expect(installWorkspace("/workspace")).rejects.toThrow("Workspace install failed (7)");
        expect(mocks.spawn).toHaveBeenCalledOnce();
    });

    it("preserves signals even when stale metadata text was emitted", async () => {
        attempts = [{ signal: "SIGTERM", stderr: [missing()] }];
        await expect(installWorkspace("/workspace")).rejects.toThrow("Workspace install failed (SIGTERM)");
        expect(mocks.spawn).toHaveBeenCalledOnce();
    });

    it("propagates process startup errors", async () => {
        attempts = [{ error: new Error("spawn ENOENT") }];
        await expect(installWorkspace("/workspace")).rejects.toThrow("spawn ENOENT");
        expect(mocks.spawn).toHaveBeenCalledOnce();
    });

    it("propagates cache refresh failure without a second install", async () => {
        attempts = [{ code: 1, stderr: [missing()] }, { code: 4 }];
        await expect(installWorkspace("/workspace")).rejects.toThrow("Package metadata refresh failed (4)");
        expect(mocks.spawn).toHaveBeenCalledTimes(2);
    });

    it("propagates a repeated miss after exactly one retry", async () => {
        attempts = [{ code: 1, stderr: [missing()] }, {}, { code: 9, stderr: [missing("another")] }];
        await expect(installWorkspace("/workspace")).rejects.toThrow("Workspace install failed (9)");
        expect(mocks.spawn).toHaveBeenCalledTimes(3);
    });

    it("caps each stream's diagnostics while streaming every byte", async () => {
        const large = "x".repeat(64 * 1024);
        attempts = [{ code: 1, stdout: [missing(), large], stderr: [missing(), large] }];
        await expect(installWorkspace("/workspace")).rejects.toThrow("Workspace install failed (1)");
        expect(mocks.spawn).toHaveBeenCalledOnce();
        expect(process.stdout.write).toHaveBeenCalledWith(Buffer.from(large));
        expect(process.stderr.write).toHaveBeenCalledWith(Buffer.from(large));
    });
});
