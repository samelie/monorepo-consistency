import type { TempWorkspace } from "../helpers/workspace.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// eslint-disable-next-line rad/no-incorrect-pkg-imports
import { ConfigManager, tsconfigHandler } from "../../src/index.js";
import { createTempWorkspace } from "../helpers/workspace.js";

describe("tsconfig domain", () => {
    let workspace: TempWorkspace;
    let configManager: ConfigManager;

    beforeEach(() => {
        configManager = ConfigManager.getInstance();
        configManager.reset();
    });

    afterEach(async () => {
        if (workspace) {
            await workspace.cleanup();
        }
        configManager.reset();
    });

    describe("validate", () => {
        it("should pass for valid tsconfig files", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    tsconfig: {
                        validation: {
                            checkExtends: true,
                            checkConsistency: true,
                        },
                    },
                },
                files: {
                    "packages/pkg-a/tsconfig.json": JSON.stringify({
                        compilerOptions: {
                            strict: true,
                            target: "ES2022",
                        },
                    }),
                    "packages/pkg-a/package.json": JSON.stringify({
                        name: "pkg-a",
                        version: "1.0.0",
                    }),
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.validate({
                cwd: workspace.root,
                files: ["packages/pkg-a/tsconfig.json"],
            });

            expect(result.success).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        it("should detect invalid JSON in tsconfig", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    tsconfig: {},
                },
                files: {
                    "packages/pkg-a/tsconfig.json": "{ invalid json }",
                    "packages/pkg-a/package.json": JSON.stringify({
                        name: "pkg-a",
                        version: "1.0.0",
                    }),
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.validate({
                cwd: workspace.root,
                files: ["packages/pkg-a/tsconfig.json"],
            });

            expect(result.success).toBe(false);
            const jsonIssue = result.issues.find(
                i => i.type === "invalid-json",
            );
            expect(jsonIssue).toBeDefined();
            expect(jsonIssue?.severity).toBe("high");
        });

        it("should detect broken extends chain", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    tsconfig: {
                        validation: { checkExtends: true },
                    },
                },
                files: {
                    "packages/pkg-a/tsconfig.json": JSON.stringify({
                        extends: "./nonexistent-base.json",
                        compilerOptions: { strict: true },
                    }),
                    "packages/pkg-a/package.json": JSON.stringify({
                        name: "pkg-a",
                        version: "1.0.0",
                    }),
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.validate({
                cwd: workspace.root,
                files: ["packages/pkg-a/tsconfig.json"],
            });

            expect(result.success).toBe(false);
            const extendsIssue = result.issues.find(
                i => i.type === "invalid-extends",
            );
            expect(extendsIssue).toBeDefined();
            expect(extendsIssue?.severity).toBe("high");
        });

        it("should pass valid extends chain", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    tsconfig: {
                        validation: { checkExtends: true },
                    },
                },
                files: {
                    "packages/pkg-a/base.json": JSON.stringify({
                        compilerOptions: { target: "ES2022" },
                    }),
                    "packages/pkg-a/tsconfig.json": JSON.stringify({
                        extends: "./base.json",
                        compilerOptions: { strict: true },
                    }),
                    "packages/pkg-a/package.json": JSON.stringify({
                        name: "pkg-a",
                        version: "1.0.0",
                    }),
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.validate({
                cwd: workspace.root,
                files: ["packages/pkg-a/tsconfig.json"],
            });

            expect(result.success).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        it("should enforce strict mode when strict option is set", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    tsconfig: {
                        validation: { strictMode: false },
                    },
                },
                files: {
                    "packages/pkg-a/tsconfig.json": JSON.stringify({
                        compilerOptions: { target: "ES2022" },
                    }),
                    "packages/pkg-a/package.json": JSON.stringify({
                        name: "pkg-a",
                        version: "1.0.0",
                    }),
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.validate({
                cwd: workspace.root,
                strict: true,
                files: ["packages/pkg-a/tsconfig.json"],
            });

            expect(result.success).toBe(false);
            const strictIssue = result.issues.find(
                i => i.type === "non-strict-mode",
            );
            expect(strictIssue).toBeDefined();
            expect(strictIssue?.severity).toBe("medium");
        });

        it("should detect missing compilerOptions in strict mode", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    tsconfig: {},
                },
                files: {
                    "packages/pkg-a/tsconfig.json": JSON.stringify({
                        include: ["src"],
                    }),
                    "packages/pkg-a/package.json": JSON.stringify({
                        name: "pkg-a",
                        version: "1.0.0",
                    }),
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.validate({
                cwd: workspace.root,
                strict: true,
                files: ["packages/pkg-a/tsconfig.json"],
            });

            const missingOpts = result.issues.find(
                i => i.type === "missing-compiler-options",
            );
            expect(missingOpts).toBeDefined();
            expect(missingOpts?.severity).toBe("medium");
        });

        it("should report correct stats", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    tsconfig: {
                        validation: { checkExtends: true },
                    },
                },
                files: {
                    "packages/pkg-a/tsconfig.json": "{ bad json",
                    "packages/pkg-a/package.json": JSON.stringify({
                        name: "pkg-a",
                        version: "1.0.0",
                    }),
                    "packages/pkg-b/tsconfig.json": JSON.stringify({
                        extends: "./missing.json",
                    }),
                    "packages/pkg-b/package.json": JSON.stringify({
                        name: "pkg-b",
                        version: "1.0.0",
                    }),
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.validate({
                cwd: workspace.root,
                files: [
                    "packages/pkg-a/tsconfig.json",
                    "packages/pkg-b/tsconfig.json",
                ],
            });

            expect(result.stats.total).toBe(result.issues.length);
            expect(result.stats.high).toBe(
                result.issues.filter(i => i.severity === "high").length,
            );
        });

        it("should handle empty files list", async () => {
            workspace = await createTempWorkspace({
                config: { version: "1.0.0", tsconfig: {} },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.validate({
                cwd: workspace.root,
                files: [],
            });

            expect(result.success).toBe(true);
            expect(result.issues).toHaveLength(0);
        });
    });

    describe("check", () => {
        it("should report missing typecheck config", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    tsconfig: {
                        generateTypecheck: true,
                        excludePatterns: [
                            "**/node_modules/**",
                            "**/dist/**",
                        ],
                    },
                },
                packages: {
                    "pkg-a": {
                        name: "pkg-a",
                        version: "1.0.0",
                    },
                },
                files: {
                    "packages/pkg-a/tsconfig.json": JSON.stringify({
                        compilerOptions: { strict: true },
                    }),
                    // Missing tsconfig.typecheck.json
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.check({
                cwd: workspace.root,
            });

            const missingTypecheck = result.issues.find(
                i => i.type === "missing-typecheck-config",
            );
            expect(missingTypecheck).toBeDefined();
            expect(missingTypecheck?.severity).toBe("low");
            expect(missingTypecheck?.fix).toContain("mono tsconfig generate");
        });

        it("should pass when typecheck config exists", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    tsconfig: {
                        generateTypecheck: true,
                        excludePatterns: [
                            "**/node_modules/**",
                            "**/dist/**",
                        ],
                    },
                },
                packages: {
                    "pkg-a": {
                        name: "pkg-a",
                        version: "1.0.0",
                    },
                },
                files: {
                    "packages/pkg-a/tsconfig.json": JSON.stringify({
                        compilerOptions: { strict: true },
                    }),
                    "packages/pkg-a/tsconfig.typecheck.json": JSON.stringify({
                        extends: "./tsconfig.json",
                        compilerOptions: { noEmit: true },
                    }),
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.check({
                cwd: workspace.root,
            });

            const missingTypecheck = result.issues.find(
                i => i.type === "missing-typecheck-config",
            );
            expect(missingTypecheck).toBeUndefined();
        });

        it("should detect broken extends chain in packages", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    tsconfig: {
                        excludePatterns: [
                            "**/node_modules/**",
                            "**/dist/**",
                        ],
                    },
                },
                packages: {
                    "pkg-a": {
                        name: "pkg-a",
                        version: "1.0.0",
                    },
                },
                files: {
                    "packages/pkg-a/tsconfig.json": JSON.stringify({
                        extends: "../config/nonexistent.json",
                        compilerOptions: { strict: true },
                    }),
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.check({
                cwd: workspace.root,
            });

            const brokenExtends = result.issues.find(
                i => i.type === "broken-extends",
            );
            expect(brokenExtends).toBeDefined();
            expect(brokenExtends?.severity).toBe("high");
        });

        it("should handle workspace with no packages", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    tsconfig: {},
                },
                packages: {},
            });

            await configManager.init({ cwd: workspace.root });

            const result = await tsconfigHandler.check({
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);
            expect(result.issues).toHaveLength(0);
        });
    });
});
