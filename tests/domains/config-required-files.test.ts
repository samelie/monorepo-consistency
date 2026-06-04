import type { TempWorkspace } from "../helpers/workspace.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// eslint-disable-next-line rad/no-incorrect-pkg-imports
import { configHandler, ConfigManager, DEFAULT_ESLINT_CONFIG_CONTENT, DEFAULT_TSCONFIG_MARKER_CONTENT } from "../../src/index.js";
import { createTempWorkspace } from "../helpers/workspace.js";

const basePackage = {
    name: "@test/pkg-a",
    version: "1.0.0",
    type: "module",
};

const vuePackage = {
    name: "@test/pkg-web",
    version: "1.0.0",
    type: "module",
    dependencies: {
        vue: "^3.5.0",
    },
};

describe("config domain - required files", () => {
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

    describe("check", () => {
        it("flags package missing eslint config and tsconfig marker", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });

            const result = await configHandler.check({ cwd: workspace.root, all: true });

            expect(result.success).toBe(false);
            const types = result.issues.map(i => i.type);
            expect(types).toContain("missing-eslint-config");
            expect(types).toContain("missing-tsconfig-marker");
        });

        it("passes when eslint.config.mjs imports @adddog/eslint and marker exists", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });
            await workspace.writeFile("packages/pkg-a/eslint.config.mjs", DEFAULT_ESLINT_CONFIG_CONTENT);
            await workspace.writeFile("packages/pkg-a/node.tsconfig.json", "{}\n");

            const result = await configHandler.check({ cwd: workspace.root, all: true });

            expect(result.issues).toEqual([]);
            expect(result.success).toBe(true);
        });

        it("accepts eslint.config.ts as alternative", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });
            await workspace.writeFile("packages/pkg-a/eslint.config.ts", DEFAULT_ESLINT_CONFIG_CONTENT);
            await workspace.writeFile("packages/pkg-a/web.tsconfig.json", "{}\n");

            const result = await configHandler.check({ cwd: workspace.root, all: true });

            expect(result.issues).toEqual([]);
        });

        it("accepts builder.tsconfig.json as marker alternative", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });
            await workspace.writeFile("packages/pkg-a/eslint.config.mjs", DEFAULT_ESLINT_CONFIG_CONTENT);
            await workspace.writeFile("packages/pkg-a/builder.tsconfig.json", "{}\n");

            const result = await configHandler.check({ cwd: workspace.root, all: true });

            expect(result.issues).toEqual([]);
        });

        it("passes customized eslint configs that still import @adddog/eslint", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });
            await workspace.writeFile(
                "packages/pkg-a/eslint.config.mjs",
                "import config from \"@adddog/eslint\";\n\nexport default config({ vue: true }).overrideRules({ \"no-console\": \"off\" });\n",
            );
            await workspace.writeFile("packages/pkg-a/node.tsconfig.json", "{}\n");

            const result = await configHandler.check({ cwd: workspace.root, all: true });

            expect(result.issues).toEqual([]);
        });

        it("flags handwritten tsconfig.json without marker as unmanaged", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });
            await workspace.writeFile("packages/pkg-a/eslint.config.mjs", DEFAULT_ESLINT_CONFIG_CONTENT);
            await workspace.writeFile("packages/pkg-a/tsconfig.json", "{ \"compilerOptions\": { \"strict\": true } }\n");

            const result = await configHandler.check({ cwd: workspace.root, all: true });

            expect(result.issues).toHaveLength(1);
            expect(result.issues[0]?.type).toBe("unmanaged-tsconfig-marker");
        });

        it("flags eslint config not importing @adddog/eslint", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });
            await workspace.writeFile("packages/pkg-a/eslint.config.mjs", "export default [];\n");
            await workspace.writeFile("packages/pkg-a/node.tsconfig.json", "{}\n");

            const result = await configHandler.check({ cwd: workspace.root, all: true });

            expect(result.issues).toHaveLength(1);
            expect(result.issues[0]?.type).toBe("invalid-eslint-config");
        });

        it("respects ignorePackages from config", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
                config: {
                    files: {
                        enabled: true,
                        rules: [
                            {
                                name: "eslint-config",
                                anyOf: ["eslint.config.mjs"],
                                defaultContent: DEFAULT_ESLINT_CONFIG_CONTENT,
                                severity: "medium",
                                ignorePackages: ["@test/*"],
                            },
                        ],
                    },
                },
            });
            await configManager.init({ cwd: workspace.root });

            const result = await configHandler.check({ cwd: workspace.root, all: true });

            expect(result.issues).toEqual([]);
        });

        it("skips all rules when files.enabled is false", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
                config: {
                    files: { enabled: false, rules: [] },
                },
            });
            await configManager.init({ cwd: workspace.root });

            const result = await configHandler.check({ cwd: workspace.root, all: true });

            expect(result.issues).toEqual([]);
        });
    });

    describe("fix --add-missing", () => {
        it("creates eslint.config.mjs with default content", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });

            const result = await configHandler.fix({ cwd: workspace.root, addMissing: true });

            expect(result.success).toBe(true);
            const content = await workspace.readFile("packages/pkg-a/eslint.config.mjs");
            expect(content).toBe(DEFAULT_ESLINT_CONFIG_CONTENT);
        });

        it("creates node.tsconfig.json for packages without web deps", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });

            await configHandler.fix({ cwd: workspace.root, addMissing: true });

            const content = await workspace.readFile("packages/pkg-a/node.tsconfig.json");
            expect(content).toBe(DEFAULT_TSCONFIG_MARKER_CONTENT);
        });

        it("creates web.tsconfig.json for packages with web deps", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-web": vuePackage },
            });

            await configHandler.fix({ cwd: workspace.root, addMissing: true });

            const content = await workspace.readFile("packages/pkg-web/web.tsconfig.json");
            expect(content).toBe(DEFAULT_TSCONFIG_MARKER_CONTENT);
        });

        it("does not create marker over handwritten tsconfig.json", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });
            const handwritten = "{ \"compilerOptions\": { \"strict\": true } }\n";
            await workspace.writeFile("packages/pkg-a/tsconfig.json", handwritten);

            const result = await configHandler.fix({ cwd: workspace.root, addMissing: true });

            // eslint config still created, but no marker (generate would clobber tsconfig.json)
            expect(result.changes.map(c => c.type)).toEqual(["create-eslint-config"]);
            expect(await workspace.readFile("packages/pkg-a/tsconfig.json")).toBe(handwritten);
            await expect(workspace.readFile("packages/pkg-a/node.tsconfig.json")).rejects.toThrow();
        });

        it("does not overwrite existing alternatives", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });
            const custom = "import config from \"@adddog/eslint\";\n\nexport default config({ vue: true })\n";
            await workspace.writeFile("packages/pkg-a/eslint.config.ts", custom);
            await workspace.writeFile("packages/pkg-a/web.tsconfig.json", "{ \"compilerOptions\": {} }\n");

            const result = await configHandler.fix({ cwd: workspace.root, addMissing: true });

            expect(result.changes).toEqual([]);
            expect(await workspace.readFile("packages/pkg-a/eslint.config.ts")).toBe(custom);
        });

        it("reports changes without writing in dry-run mode", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage },
            });

            const result = await configHandler.fix({ cwd: workspace.root, addMissing: true, dryRun: true });

            expect(result.changes.length).toBeGreaterThan(0);
            await expect(workspace.readFile("packages/pkg-a/eslint.config.mjs")).rejects.toThrow();
        });

        it("check passes after fix", async () => {
            workspace = await createTempWorkspace({
                packages: { "pkg-a": basePackage, "pkg-web": vuePackage },
            });

            await configHandler.fix({ cwd: workspace.root, addMissing: true });
            const result = await configHandler.check({ cwd: workspace.root, all: true });

            expect(result.issues).toEqual([]);
            expect(result.success).toBe(true);
        });
    });
});
