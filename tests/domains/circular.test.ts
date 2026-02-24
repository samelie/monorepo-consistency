import type { TempWorkspace } from "../helpers/workspace.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line rad/no-incorrect-pkg-imports
import { circularHandler, ConfigManager } from "../../src/index.js";
import { createTempWorkspace } from "../helpers/workspace.js";

// Mock the runners to avoid real dpdm/madge execution
vi.mock("../../src/runners/dpdm", () => ({
    runDpdm: vi.fn().mockResolvedValue({ circular: [] }),
}));

vi.mock("../../src/runners/madge", () => ({
    runMadge: vi.fn().mockResolvedValue({ circular: [] }),
}));

describe("circularHandler", () => {
    let workspace: TempWorkspace;
    let configManager: ConfigManager;

    beforeEach(() => {
        configManager = ConfigManager.getInstance();
        configManager.reset();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        if (workspace) {
            await workspace.cleanup();
        }
        configManager.reset();
    });

    describe("check - inter-package", () => {
        it("should detect workspace dependency cycles", async () => {
            workspace = await createTempWorkspace({
                config: { version: "1.0.0" },
                packages: {
                    "pkg-a": {
                        name: "@test/pkg-a",
                        version: "1.0.0",
                        dependencies: { "@test/pkg-b": "workspace:*" },
                    },
                    "pkg-b": {
                        name: "@test/pkg-b",
                        version: "1.0.0",
                        dependencies: { "@test/pkg-a": "workspace:*" },
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await circularHandler.check({
                inter: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(false);
            expect(result.issues.length).toBe(1);
            expect(result.issues[0].type).toBe("circular-workspace-dep");
            expect(result.issues[0].severity).toBe("critical");
        });

        it("should return clean when no cycles exist", async () => {
            workspace = await createTempWorkspace({
                config: { version: "1.0.0" },
                packages: {
                    "pkg-a": {
                        name: "@test/pkg-a",
                        version: "1.0.0",
                        dependencies: { "@test/pkg-b": "workspace:*" },
                    },
                    "pkg-b": {
                        name: "@test/pkg-b",
                        version: "1.0.0",
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await circularHandler.check({
                inter: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);
            expect(result.issues).toHaveLength(0);
        });
    });

    describe("check - intra-package (mocked)", () => {
        it("should return no issues when runners report no cycles", async () => {
            workspace = await createTempWorkspace({
                config: { version: "1.0.0" },
                packages: {
                    "pkg-a": {
                        name: "@test/pkg-a",
                        version: "1.0.0",
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await circularHandler.check({
                intra: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        it("should report cycles found by runners", async () => {
            const { runDpdm } = await import("../../src/runners/dpdm");
            vi.mocked(runDpdm).mockResolvedValueOnce({
                circular: [["src/a.ts", "src/b.ts", "src/a.ts"]],
            });

            workspace = await createTempWorkspace({
                config: { version: "1.0.0" },
                packages: {
                    "pkg-a": {
                        name: "@test/pkg-a",
                        version: "1.0.0",
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await circularHandler.check({
                intra: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(false);
            expect(result.issues.length).toBe(1);
            expect(result.issues[0].type).toBe("circular-import");
            expect(result.issues[0].severity).toBe("high");
        });
    });

    describe("check - config options", () => {
        it("should respect enabled: false", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    circular: { enabled: false },
                },
                packages: {
                    "pkg-a": {
                        name: "@test/pkg-a",
                        version: "1.0.0",
                        dependencies: { "@test/pkg-b": "workspace:*" },
                    },
                    "pkg-b": {
                        name: "@test/pkg-b",
                        version: "1.0.0",
                        dependencies: { "@test/pkg-a": "workspace:*" },
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await circularHandler.check({ cwd: workspace.root });

            expect(result.success).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        it("should respect ignorePackageCycles config", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    circular: {
                        ignorePackageCycles: [["@test/pkg-a", "@test/pkg-b"]],
                    },
                },
                packages: {
                    "pkg-a": {
                        name: "@test/pkg-a",
                        version: "1.0.0",
                        dependencies: { "@test/pkg-b": "workspace:*" },
                    },
                    "pkg-b": {
                        name: "@test/pkg-b",
                        version: "1.0.0",
                        dependencies: { "@test/pkg-a": "workspace:*" },
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await circularHandler.check({
                inter: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        it("should filter packages with excludePackages config", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    circular: {
                        excludePackages: ["@test/pkg-a"],
                    },
                },
                packages: {
                    "pkg-a": {
                        name: "@test/pkg-a",
                        version: "1.0.0",
                    },
                    "pkg-b": {
                        name: "@test/pkg-b",
                        version: "1.0.0",
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            // Intra-only — the excluded package should not be scanned
            const result = await circularHandler.check({
                intra: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);
        });
    });

    describe("check - stats", () => {
        it("should calculate stats correctly", async () => {
            workspace = await createTempWorkspace({
                config: { version: "1.0.0" },
                packages: {
                    "pkg-a": {
                        name: "@test/pkg-a",
                        version: "1.0.0",
                        dependencies: { "@test/pkg-b": "workspace:*" },
                    },
                    "pkg-b": {
                        name: "@test/pkg-b",
                        version: "1.0.0",
                        dependencies: { "@test/pkg-a": "workspace:*" },
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await circularHandler.check({
                inter: true,
                cwd: workspace.root,
            });

            expect(result.stats.total).toBe(result.issues.length);
            expect(result.stats.critical).toBe(
                result.issues.filter(i => i.severity === "critical").length,
            );
        });
    });
});
