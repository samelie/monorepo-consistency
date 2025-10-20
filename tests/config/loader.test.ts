import type { TempWorkspace } from "../helpers/workspace.js";
import { afterEach, describe, expect, it } from "vitest";

// eslint-disable-next-line rad/no-incorrect-pkg-imports
import { ConfigLoaderError, ConfigManager, loadConfig, loadConfigSync } from "../../src/index.js";
import { fullConfig, minimalConfig, scriptEnforcementConfig } from "../fixtures/configs.js";
import { createTempWorkspace } from "../helpers/workspace.js";

describe("config loader", () => {
    let workspace: TempWorkspace;

    afterEach(async () => {
        if (workspace) {
            await workspace.cleanup();
        }
    });

    describe("loadConfig", () => {
        it("should load JSON config", async () => {
            workspace = await createTempWorkspace({
                config: minimalConfig,
            });

            const config = await loadConfig({
                cwd: workspace.root,
            });

            expect(config.version).toBe("1.0.0");
            expect(config.deps?.checkUnused).toBe(true);
        });

        it("should load config from specific path", async () => {
            workspace = await createTempWorkspace({
                files: {
                    "custom.config.json": JSON.stringify(scriptEnforcementConfig),
                },
            });

            const config = await loadConfig({
                configPath: workspace.path("custom.config.json"),
            });

            expect(config.packageJson?.scripts?.required).toEqual({
                test: "vitest",
                lint: "eslint .",
                types: "tsc --noEmit",
            });
        });

        it("should throw when config file not found", async () => {
            workspace = await createTempWorkspace();

            await expect(
                loadConfig({
                    configPath: workspace.path("nonexistent.json"),
                }),
            ).rejects.toThrow(ConfigLoaderError);
        });

        it("should load config from package.json monorepo field", async () => {
            workspace = await createTempWorkspace();

            await workspace.writeJSON("package.json", {
                name: "test",
                version: "1.0.0",
                monorepo: minimalConfig,
            });

            const config = await loadConfig({
                cwd: workspace.root,
            });

            expect(config.version).toBe("1.0.0");
            expect(config.deps?.checkUnused).toBe(true);
        });

        it("should throw when package.json has no monorepo field", async () => {
            workspace = await createTempWorkspace();

            // Create a package.json without monorepo field
            await workspace.writeJSON("package.json", {
                name: "test",
                version: "1.0.0",
            });

            // Remove the default config file
            await workspace.writeFile("monorepo.config.json", "");

            await expect(
                loadConfig({
                    configPath: workspace.path("package.json"),
                }),
            ).rejects.toThrow("No \"monorepo\" field found in package.json");
        });

        it("should handle extends property", async () => {
            workspace = await createTempWorkspace();

            // Create base config
            await workspace.writeJSON("base.config.json", {
                version: "1.0.0",
                deps: { checkUnused: true },
                packageJson: {
                    scripts: {
                        required: { test: "vitest" },
                    },
                },
            });

            // Create extended config
            await workspace.writeJSON("extended.config.json", {
                extends: "./base.config.json",
                packageJson: {
                    scripts: {
                        required: { lint: "eslint ." },
                    },
                },
            });

            const config = await loadConfig({
                configPath: workspace.path("extended.config.json"),
            });

            // Should have both base and extended values
            expect(config.deps?.checkUnused).toBe(true);
            expect(config.packageJson?.scripts?.required).toEqual({
                lint: "eslint .",
            });
        });

        it("should handle array of extends", async () => {
            workspace = await createTempWorkspace();

            await workspace.writeJSON("base1.json", {
                version: "1.0.0",
                deps: { checkUnused: true },
            });

            await workspace.writeJSON("base2.json", {
                version: "1.0.0",
                packageJson: {
                    scripts: {
                        required: { test: "vitest" },
                    },
                },
            });

            await workspace.writeJSON("extended.json", {
                extends: ["./base1.json", "./base2.json"],
                deps: {
                    taze: { runner: "npx" },
                },
            });

            const config = await loadConfig({
                configPath: workspace.path("extended.json"),
            });

            expect(config.deps?.checkUnused).toBe(true);
            expect(config.packageJson?.scripts?.required).toEqual({ test: "vitest" });
            expect(config.deps?.taze?.runner).toBe("npx");
        });

        it("should throw ConfigValidationError for invalid config", async () => {
            workspace = await createTempWorkspace();

            await workspace.writeJSON("invalid.json", {
                version: "1.0.0",
                packageJson: {
                    scripts: {
                        required: "should-be-object", // Invalid type
                    },
                },
            });

            await expect(
                loadConfig({
                    configPath: workspace.path("invalid.json"),
                }),
            ).rejects.toThrow(/validation failed/i);
        });

        it("should merge with defaults", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    workspace: { packageManager: "pnpm" },
                },
            });

            const config = await loadConfig({
                cwd: workspace.root,
                defaults: {
                    deps: {
                        taze: { runner: "npx" },
                    },
                },
            });

            expect(config.deps?.checkUnused).toBe(true);
            expect(config.deps?.taze?.runner).toBe("npx");
        });

        it("should skip validation when validate is false", async () => {
            workspace = await createTempWorkspace();

            await workspace.writeJSON("invalid.json", {
                invalidField: "bad",
            });

            // Should not throw
            const config = await loadConfig({
                configPath: workspace.path("invalid.json"),
                validate: false,
            });

            expect(config).toBeDefined();
        });

        it("should load full config correctly", async () => {
            workspace = await createTempWorkspace({
                config: fullConfig,
            });

            const config = await loadConfig({
                cwd: workspace.root,
            });

            expect(config.version).toBe("1.0.0");
            expect(config.deps?.checkUnused).toBe(true);
            expect(config.packageJson?.scripts?.required).toEqual({
                test: "vitest",
                lint: "eslint .",
            });
            expect(config.deps?.taze?.runner).toBe("npx");
            expect(config.packageJson?.autoFix?.addMissingScripts).toBe(true);
        });
    });

    describe("loadConfigSync", () => {
        it("should load JSON config synchronously", async () => {
            workspace = await createTempWorkspace({
                config: minimalConfig,
            });

            const config = loadConfigSync({
                cwd: workspace.root,
            });

            expect(config.version).toBe("1.0.0");
            expect(config.deps?.checkUnused).toBe(true);
        });

        it("should throw for non-JSON files", async () => {
            workspace = await createTempWorkspace();

            await workspace.writeFile(
                "config.js",
                "export default { workspace: { monorepoRoot: '.' } }",
            );

            expect(() =>
                loadConfigSync({
                    configPath: workspace.path("config.js"),
                }),
            ).toThrow("Synchronous loading only supports JSON configuration files");
        });

        it("should throw when extends is present", async () => {
            workspace = await createTempWorkspace();

            await workspace.writeJSON("base.json", {
                workspace: { monorepoRoot: "." },
            });

            await workspace.writeJSON("extended.json", {
                extends: "./base.json",
            });

            expect(() =>
                loadConfigSync({
                    configPath: workspace.path("extended.json"),
                }),
            ).toThrow("Configuration extends is not supported in synchronous mode");
        });
    });

    describe("configManager", () => {
        it("should be a singleton", () => {
            const instance1 = ConfigManager.getInstance();
            const instance2 = ConfigManager.getInstance();

            expect(instance1).toBe(instance2);
        });

        it("should initialize and get config", async () => {
            workspace = await createTempWorkspace({
                config: minimalConfig,
            });

            const manager = ConfigManager.getInstance();
            await manager.init({ cwd: workspace.root });

            const config = manager.getConfig();
            expect(config.version).toBe("1.0.0");
            expect(config.deps?.checkUnused).toBe(true);
        });

        it("should throw when getting config before init", () => {
            const manager = ConfigManager.getInstance();
            manager.reset();

            expect(() => manager.getConfig()).toThrow("Configuration not initialized");
        });

        it("should update config", async () => {
            workspace = await createTempWorkspace({
                config: minimalConfig,
            });

            const manager = ConfigManager.getInstance();
            await manager.init({ cwd: workspace.root });

            manager.updateConfig({
                deps: {
                    taze: { runner: "npx" },
                },
            });

            const config = manager.getConfig();
            expect(config.deps?.checkUnused).toBe(true);
            expect(config.deps?.taze?.runner).toBe("npx");
        });

        it("should reset config", async () => {
            workspace = await createTempWorkspace({
                config: minimalConfig,
            });

            const manager = ConfigManager.getInstance();
            await manager.init({ cwd: workspace.root });

            manager.reset();

            expect(() => manager.getConfig()).toThrow("Configuration not initialized");
        });

        it("should store config path", async () => {
            workspace = await createTempWorkspace({
                config: minimalConfig,
            });

            const manager = ConfigManager.getInstance();
            await manager.init({ cwd: workspace.root });

            const configPath = manager.getConfigPath();
            expect(configPath).toBe(workspace.path("monorepo.config.json"));
        });
    });

    describe("error handling", () => {
        it("should throw ConfigLoaderError with path", async () => {
            workspace = await createTempWorkspace();

            try {
                await loadConfig({
                    configPath: workspace.path("missing.json"),
                });
                expect.fail("Should have thrown");
            } catch (error) {
                expect(error).toBeInstanceOf(ConfigLoaderError);
                expect((error as ConfigLoaderError).path).toBe(
                    workspace.path("missing.json"),
                );
            }
        });

        it("should include validation issues in error", async () => {
            workspace = await createTempWorkspace();

            await workspace.writeJSON("invalid.json", {
                version: "1.0.0",
                packageJson: {
                    scripts: {
                        required: "invalid-type",
                    },
                },
            });

            try {
                await loadConfig({
                    configPath: workspace.path("invalid.json"),
                });
                expect.fail("Should have thrown");
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
                expect((error as Error).message).toContain("validation failed");
            }
        });
    });
});
