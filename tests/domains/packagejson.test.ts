import type { TempWorkspace } from "../helpers/workspace.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// eslint-disable-next-line rad/no-incorrect-pkg-imports
import { ConfigManager, packageJsonHandler } from "../../src/index.js";
import {
    consistencyConfig,
    fieldEnforcementConfig,
    scriptEnforcementConfig,
} from "../fixtures/configs.js";
import {
    packageMissingFields,
    packageMissingScripts,
    packageWithDifferentLicense,
    packageWithEngines,
    packageWithForbiddenFields,
    packageWithForbiddenScripts,
    packageWithoutEngines,
    packageWithWrongScripts,
    validPackage,
} from "../fixtures/packages.js";
import { createTempWorkspace } from "../helpers/workspace.js";

describe("packageJson domain", () => {
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

    describe("check - scripts", () => {
        it("should detect missing required scripts", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": packageMissingScripts,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                scripts: true,
                cwd: workspace.root,
            });

            // Success is true because there are no CRITICAL issues (only high/medium/low)
            expect(result.success).toBe(true);
            expect(result.issues.length).toBeGreaterThan(0);

            const missingTest = result.issues.find(
                i => i.type === "missing-script" && i.message.includes("test"),
            );
            const missingLint = result.issues.find(
                i => i.type === "missing-script" && i.message.includes("lint"),
            );

            expect(missingTest).toBeDefined();
            expect(missingLint).toBeDefined();
            expect(missingTest?.severity).toBe("high");
        });

        it("should detect script mismatches", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": packageWithWrongScripts,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                scripts: true,
                cwd: workspace.root,
            });

            const mismatch = result.issues.find(i => i.type === "script-mismatch");
            expect(mismatch).toBeDefined();
            expect(mismatch?.severity).toBe("medium");
            expect(mismatch?.message).toContain("differs from standard");
        });

        it("should detect forbidden scripts", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": packageWithForbiddenScripts,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                scripts: true,
                cwd: workspace.root,
            });

            const forbiddenScripts = result.issues.filter(
                i => i.type === "forbidden-script",
            );
            expect(forbiddenScripts.length).toBe(2); // postinstall and prepare
            expect(forbiddenScripts[0].severity).toBe("high");
        });

        it("should detect missing recommended scripts as low severity", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": {
                        name: "pkg-a",
                        version: "1.0.0",
                        scripts: {
                            test: "vitest",
                            lint: "eslint .",
                            types: "tsc --noEmit",
                            // Missing recommended scripts
                        },
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                scripts: true,
                cwd: workspace.root,
            });

            const missingRecommended = result.issues.filter(
                i => i.type === "missing-recommended-script",
            );
            expect(missingRecommended.length).toBeGreaterThan(0);
            expect(missingRecommended[0].severity).toBe("low");
        });

        it("should ignore packages matching ignore patterns", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "@internal/tools": {
                        name: "@internal/tools",
                        version: "1.0.0",
                        scripts: {}, // Missing all required scripts
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                scripts: true,
                cwd: workspace.root,
            });

            // Should have no issues because @internal/* is ignored
            expect(result.issues).toHaveLength(0);
            expect(result.success).toBe(true);
        });

        it("should pass when all scripts are correct", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": validPackage,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                scripts: true,
                cwd: workspace.root,
            });

            const scriptIssues = result.issues.filter(i =>
                ["missing-script", "script-mismatch", "forbidden-script"].includes(
                    i.type,
                ),
            );
            expect(scriptIssues).toHaveLength(0);
        });
    });

    describe("check - fields", () => {
        it("should detect missing required fields", async () => {
            workspace = await createTempWorkspace({
                config: fieldEnforcementConfig,
                packages: {
                    "pkg-a": packageMissingFields,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                fields: true,
                cwd: workspace.root,
            });

            const missingFields = result.issues.filter(i => i.type === "missing-field");
            expect(missingFields.length).toBeGreaterThan(0);

            const missingLicense = missingFields.find(i => i.message.includes("license"));
            expect(missingLicense).toBeDefined();
            expect(missingLicense?.severity).toBe("high");
        });

        it("should detect forbidden fields", async () => {
            workspace = await createTempWorkspace({
                config: fieldEnforcementConfig,
                packages: {
                    "pkg-a": packageWithForbiddenFields,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                fields: true,
                cwd: workspace.root,
            });

            const forbiddenFields = result.issues.filter(
                i => i.type === "forbidden-field",
            );
            expect(forbiddenFields.length).toBe(2); // publishConfig and bundleDependencies
            expect(forbiddenFields[0].severity).toBe("medium");
        });

        it("should provide fix suggestions with default values", async () => {
            workspace = await createTempWorkspace({
                config: fieldEnforcementConfig,
                packages: {
                    "pkg-a": packageMissingFields,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                fields: true,
                cwd: workspace.root,
            });

            const missingLicense = result.issues.find(
                i => i.type === "missing-field" && i.message.includes("license"),
            );
            expect(missingLicense?.fix).toContain("MIT");
        });
    });

    describe("check - consistency", () => {
        it("should detect inconsistent licenses across packages", async () => {
            workspace = await createTempWorkspace({
                config: consistencyConfig,
                packages: {
                    "pkg-a": validPackage,
                    "pkg-b": packageWithDifferentLicense,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                consistency: true,
                cwd: workspace.root,
            });

            const licenseMismatch = result.issues.find(
                i => i.type === "inconsistent-license",
            );
            expect(licenseMismatch).toBeDefined();
            expect(licenseMismatch?.severity).toBe("medium");
            expect(licenseMismatch?.message).toContain("Multiple licenses found");
        });

        it("should detect missing engines field", async () => {
            workspace = await createTempWorkspace({
                config: consistencyConfig,
                packages: {
                    "pkg-a": packageWithoutEngines,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                consistency: true,
                cwd: workspace.root,
            });

            const missingEngines = result.issues.find(i => i.type === "missing-engines");
            expect(missingEngines).toBeDefined();
            expect(missingEngines?.severity).toBe("low");
        });

        it("should pass when licenses are consistent", async () => {
            workspace = await createTempWorkspace({
                config: consistencyConfig,
                packages: {
                    "pkg-a": validPackage,
                    "pkg-b": packageWithEngines,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                consistency: true,
                cwd: workspace.root,
            });

            const licenseMismatch = result.issues.find(
                i => i.type === "inconsistent-license",
            );
            expect(licenseMismatch).toBeUndefined();
        });
    });

    describe("check - all", () => {
        it("should run all checks when all option is true", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    packageJson: {
                        scripts: scriptEnforcementConfig.packageJson?.scripts,
                        fields: fieldEnforcementConfig.packageJson?.fields,
                        consistency: consistencyConfig.packageJson?.consistency,
                        autoFix: scriptEnforcementConfig.packageJson?.autoFix,
                    },
                },
                packages: {
                    "pkg-a": packageMissingScripts,
                    "pkg-b": packageMissingFields,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                all: true,
                cwd: workspace.root,
            });

            expect(result.issues.length).toBeGreaterThan(0);
            // Success is true because there are no CRITICAL issues
            expect(result.success).toBe(true);

            // Should have issues from all check types
            const hasScriptIssues = result.issues.some(i => i.type === "missing-script");
            const hasFieldIssues = result.issues.some(i => i.type === "missing-field");

            expect(hasScriptIssues).toBe(true);
            expect(hasFieldIssues).toBe(true);
        });

        it("should calculate stats correctly", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": packageMissingScripts,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                scripts: true,
                cwd: workspace.root,
            });

            expect(result.stats.total).toBe(result.issues.length);
            expect(result.stats.high).toBe(
                result.issues.filter(i => i.severity === "high").length,
            );
            expect(result.stats.medium).toBe(
                result.issues.filter(i => i.severity === "medium").length,
            );
            expect(result.stats.low).toBe(
                result.issues.filter(i => i.severity === "low").length,
            );
        });
    });

    describe("fix - scripts", () => {
        it("should add missing required scripts", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": packageMissingScripts,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.fix({
                addScripts: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);
            expect(result.applied).toBeGreaterThan(0);

            // Verify file was written
            const pkgJson = await workspace.readJSON<{ scripts: Record<string, string> }>(
                "packages/pkg-a/package.json",
            );
            expect(pkgJson.scripts.test).toBe("vitest");
            expect(pkgJson.scripts.lint).toBe("eslint .");
            expect(pkgJson.scripts.types).toBe("tsc --noEmit");
        });

        it("should add recommended scripts", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": {
                        name: "pkg-a",
                        version: "1.0.0",
                        scripts: {
                            test: "vitest",
                            lint: "eslint .",
                            types: "tsc --noEmit",
                        },
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.fix({
                addRecommendedScripts: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);

            const pkgJson = await workspace.readJSON<{ scripts: Record<string, string> }>(
                "packages/pkg-a/package.json",
            );
            expect(pkgJson.scripts["lint:fix"]).toBe("eslint --fix .");
            expect(pkgJson.scripts.build).toBe("tsup");
        });

        it("should remove forbidden scripts", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": packageWithForbiddenScripts,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.fix({
                removeScripts: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);

            const pkgJson = await workspace.readJSON<{ scripts: Record<string, string> }>(
                "packages/pkg-a/package.json",
            );
            expect(pkgJson.scripts.postinstall).toBeUndefined();
            expect(pkgJson.scripts.prepare).toBeUndefined();
            expect(pkgJson.scripts.test).toBe("vitest"); // Should keep valid scripts
        });

        it("should respect ignore patterns when fixing", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "@internal/tools": {
                        name: "@internal/tools",
                        version: "1.0.0",
                        scripts: {},
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.fix({
                addScripts: true,
                cwd: workspace.root,
            });

            // Should not modify ignored packages
            expect(result.applied).toBe(0);

            const pkgJson = await workspace.readJSON<{ scripts: Record<string, string> }>(
                "packages/@internal/tools/package.json",
            );
            expect(pkgJson.scripts).toEqual({});
        });

        it("should respect dryRun option", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": packageMissingScripts,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.fix({
                addScripts: true,
                dryRun: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);

            // File should NOT be modified
            const pkgJson = await workspace.readJSON("packages/pkg-a/package.json");
            expect(pkgJson).toEqual(packageMissingScripts);
        });

        it("should track changes correctly", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": packageMissingScripts,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.fix({
                addScripts: true,
                cwd: workspace.root,
            });

            expect(result.changes.length).toBeGreaterThan(0);

            const addedTest = result.changes.find(
                c => c.type === "add-script" && c.description.includes("test"),
            );
            expect(addedTest).toBeDefined();
            expect(addedTest?.package).toBe("@test/missing-scripts");
        });
    });

    describe("fix - fields", () => {
        it("should add missing required fields with defaults", async () => {
            workspace = await createTempWorkspace({
                config: fieldEnforcementConfig,
                packages: {
                    "pkg-a": packageMissingFields,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.fix({
                addFields: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);

            const pkgJson = await workspace.readJSON<{ license?: string; type?: string }>(
                "packages/pkg-a/package.json",
            );
            expect(pkgJson.license).toBe("MIT");
            expect(pkgJson.type).toBe("module");
        });

        it("should remove forbidden fields", async () => {
            workspace = await createTempWorkspace({
                config: fieldEnforcementConfig,
                packages: {
                    "pkg-a": packageWithForbiddenFields,
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.fix({
                removeFields: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);

            const pkgJson = await workspace.readJSON<{
                publishConfig?: unknown;
                bundleDependencies?: unknown;
            }>("packages/pkg-a/package.json");
            expect(pkgJson.publishConfig).toBeUndefined();
            expect(pkgJson.bundleDependencies).toBeUndefined();
        });
    });

    describe("fix - all", () => {
        it("should fix all issues when all option is true", async () => {
            workspace = await createTempWorkspace({
                config: {
                    version: "1.0.0",
                    packageJson: {
                        scripts: scriptEnforcementConfig.packageJson?.scripts,
                        fields: fieldEnforcementConfig.packageJson?.fields,
                        autoFix: {
                            addMissingScripts: true,
                            removeInvalidFields: true,
                        },
                    },
                },
                packages: {
                    "pkg-a": {
                        ...packageMissingScripts,
                        ...packageMissingFields,
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.fix({
                all: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);
            expect(result.applied).toBeGreaterThan(0);

            const pkgJson = await workspace.readJSON<{
                scripts: Record<string, string>;
                license?: string;
            }>("packages/pkg-a/package.json");

            // Should have added scripts
            expect(pkgJson.scripts.test).toBe("vitest");
            // Should have added fields
            expect(pkgJson.license).toBe("MIT");
        });
    });

    describe("edge cases", () => {
        it("should handle empty workspace", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {},
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                scripts: true,
                cwd: workspace.root,
            });

            expect(result.success).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        it("should handle package with no scripts field", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": {
                        name: "pkg-a",
                        version: "1.0.0",
                        // No scripts field at all
                    },
                },
            });

            await configManager.init({ cwd: workspace.root });

            const result = await packageJsonHandler.check({
                scripts: true,
                cwd: workspace.root,
            });

            expect(result.issues.length).toBeGreaterThan(0);
            expect(result.success).toBe(true); // No critical issues

            // Should have both missing required and missing recommended scripts
            const hasMissingScript = result.issues.some(i => i.type === "missing-script");
            const hasMissingRecommended = result.issues.some(i => i.type === "missing-recommended-script");

            expect(hasMissingScript).toBe(true);
            expect(hasMissingRecommended).toBe(true);
        });

        it("should preserve JSON formatting when writing", async () => {
            workspace = await createTempWorkspace({
                config: scriptEnforcementConfig,
                packages: {
                    "pkg-a": packageMissingScripts,
                },
            });

            await configManager.init({ cwd: workspace.root });

            await packageJsonHandler.fix({
                addScripts: true,
                cwd: workspace.root,
            });

            const content = await workspace.readFile("packages/pkg-a/package.json");
            // Should be properly formatted with 2 spaces and trailing newline
            expect(content.endsWith("\n")).toBe(true);
            expect(content).toContain("  "); // 2-space indent
        });
    });
});
