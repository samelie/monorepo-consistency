import { describe, expect, it } from "vitest";
// eslint-disable-next-line rad/no-incorrect-pkg-imports
import { defaultKnipConfig, defineKnipConfig } from "../../src/index.js";

describe("knip defaults", () => {
    describe("defaultKnipConfig", () => {
        it("should have a $schema field", () => {
            expect(defaultKnipConfig.$schema).toBe(
                "https://unpkg.com/knip@6/schema.json",
            );
        });

        it("should disable eslint plugin", () => {
            expect(defaultKnipConfig.eslint).toBe(false);
        });

        it("should have default entry and project arrays", () => {
            expect(defaultKnipConfig.entry).toEqual([]);
            expect(defaultKnipConfig.project).toEqual([]);
        });

        it("should have universal ignore patterns", () => {
            const ignore = defaultKnipConfig.ignore as string[];
            expect(ignore).toContain("**/dist/**");
            expect(ignore).toContain("**/vite-env.d.ts");
            expect(ignore).toContain("**/eslint.config.mjs");
        });

        it("should not ignore tailwind.config.ts (let tailwind plugin handle it)", () => {
            const ignore = defaultKnipConfig.ignore as string[];
            expect(ignore).not.toContain("**/tailwind.config.ts");
        });

        it("should have rules with expected severity levels", () => {
            const rules = defaultKnipConfig.rules as Record<string, string>;
            expect(rules.dependencies).toBe("error");
            expect(rules.unlisted).toBe("error");
            expect(rules.files).toBe("error");
            expect(rules.exports).toBe("error");
            expect(rules.nsExports).toBe("off");
        });

        it("should have typescript config pointing to tsconfig.json", () => {
            const ts = defaultKnipConfig.typescript as { config: string[] };
            expect(ts.config).toEqual(["./tsconfig.json"]);
        });

        it("should have vitest config with glob patterns", () => {
            const vitest = defaultKnipConfig.vitest as {
                config: string[];
                entry: string[];
            };
            expect(vitest.config.length).toBeGreaterThan(0);
            expect(vitest.entry.length).toBeGreaterThan(0);
        });

        it("should have empty arrays for user-configurable lists", () => {
            expect(defaultKnipConfig.ignoreBinaries).toEqual([]);
            expect(defaultKnipConfig.ignoreDependencies).toEqual([]);
            expect(defaultKnipConfig.ignoreMembers).toEqual([]);
            expect(defaultKnipConfig.ignoreUnresolved).toEqual([]);
            expect(defaultKnipConfig.ignoreWorkspaces).toEqual([]);
            expect(defaultKnipConfig.include).toEqual([]);
            expect(defaultKnipConfig.exclude).toEqual([]);
            expect(defaultKnipConfig.tags).toEqual([]);
        });
    });

    describe("defineKnipConfig", () => {
        it("should return defaults when called with no args", () => {
            const config = defineKnipConfig();
            expect(config.$schema).toBe(defaultKnipConfig.$schema);
            expect(config.eslint).toBe(false);
            expect(config.rules).toEqual(defaultKnipConfig.rules);
        });

        it("should override scalar values", () => {
            const config = defineKnipConfig({
                eslint: true,
                treatConfigHintsAsErrors: true,
            });
            expect(config.eslint).toBe(true);
            expect(config.treatConfigHintsAsErrors).toBe(true);
        });

        it("should concatenate arrays instead of replacing", () => {
            const config = defineKnipConfig({
                ignore: ["**/custom/**"],
                ignoreBinaries: ["my-bin"],
            });

            const ignore = config.ignore as string[];
            const ignoreBinaries = config.ignoreBinaries as string[];

            // Should have overrides concatenated with (empty) defaults
            expect(ignore).toContain("**/custom/**");
            expect(ignoreBinaries).toContain("my-bin");
        });

        it("should concatenate ignoreDependencies arrays", () => {
            const config = defineKnipConfig({
                ignoreDependencies: ["tailwindcss", "postcss"],
            });
            const ignoreDeps = config.ignoreDependencies as string[];
            expect(ignoreDeps).toContain("tailwindcss");
            expect(ignoreDeps).toContain("postcss");
        });

        it("should deep merge nested objects", () => {
            const config = defineKnipConfig({
                rules: {
                    exports: "warn",
                },
            });

            const rules = config.rules as Record<string, string>;
            expect(rules.exports).toBe("warn"); // overridden
            expect(rules.dependencies).toBe("error"); // kept from default
        });

        it("should merge plugin configs", () => {
            const config = defineKnipConfig({
                vite: { config: ["vite.config.ts"] },
                tailwind: { entry: ["tailwind.config.ts"] },
            });
            expect(config.vite).toEqual({ config: ["vite.config.ts"] });
            expect(config.tailwind).toEqual({ entry: ["tailwind.config.ts"] });
        });

        it("should add new top-level keys", () => {
            const config = defineKnipConfig({
                customField: "custom-value",
            });
            expect(config.customField).toBe("custom-value");
        });

        it("should not mutate the default config", () => {
            const originalIgnore = [...(defaultKnipConfig.ignore as string[])];
            defineKnipConfig({ ignore: ["**/extra/**"] });

            expect(defaultKnipConfig.ignore).toEqual(originalIgnore);
        });

        it("should handle empty overrides object", () => {
            const config = defineKnipConfig({});
            expect(config).toEqual(defaultKnipConfig);
        });

        it("should override nested object entirely when not an array", () => {
            const config = defineKnipConfig({
                typescript: {
                    config: ["./tsconfig.build.json"],
                },
            });

            // Arrays inside nested objects should concatenate
            const ts = config.typescript as { config: string[] };
            expect(ts.config).toEqual([
                "./tsconfig.json",
                "./tsconfig.build.json",
            ]);
        });

        it("should handle workspaces overrides", () => {
            const config = defineKnipConfig({
                workspaces: {
                    "packages/*": {
                        entry: ["src/main.ts"],
                    },
                },
            });
            const workspaces = config.workspaces as Record<string, unknown>;
            expect(workspaces["packages/*"]).toEqual({
                entry: ["src/main.ts"],
            });
        });
    });

    describe("defineKnipConfig with schemaDefaults", () => {
        it("should merge schema defaults between internal defaults and overrides", () => {
            const config = defineKnipConfig(
                { ignore: ["**/custom/**"] },
                { ignoreDependencies: ["lodash"] },
            );

            const ignore = config.ignore as string[];
            const ignoreDeps = config.ignoreDependencies as string[];

            // Override present
            expect(ignore).toContain("**/custom/**");
            // Schema default present
            expect(ignoreDeps).toContain("lodash");
        });

        it("should apply schema defaults scalars", () => {
            const config = defineKnipConfig(
                {},
                { treatConfigHintsAsErrors: true },
            );
            expect(config.treatConfigHintsAsErrors).toBe(true);
        });

        it("should let overrides win over schema defaults", () => {
            const config = defineKnipConfig(
                { rules: { exports: "error" } },
                { rules: { exports: "warn" } },
            );
            const rules = config.rules as Record<string, string>;
            expect(rules.exports).toBe("error");
        });

        it("should concatenate arrays at both merge levels", () => {
            const config = defineKnipConfig(
                { ignore: ["**/override/**"] },
                { ignore: ["**/schema/**"] },
            );
            const ignore = config.ignore as string[];
            // Schema + override sources (defaults are empty)
            expect(ignore).toContain("**/schema/**"); // schema
            expect(ignore).toContain("**/override/**"); // override
        });

        it("should not mutate defaultKnipConfig", () => {
            const originalIgnore = [...(defaultKnipConfig.ignore as string[])];
            defineKnipConfig(
                { ignore: ["**/a/**"] },
                { ignore: ["**/b/**"] },
            );
            expect(defaultKnipConfig.ignore).toEqual(originalIgnore);
        });

        it("backward compat: single-arg still works", () => {
            const config = defineKnipConfig({ eslint: true });
            expect(config.eslint).toBe(true);
            expect(config.rules).toEqual(defaultKnipConfig.rules);
        });
    });
});
