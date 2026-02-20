import { describe, expect, it } from "vitest";
// eslint-disable-next-line rad/no-incorrect-pkg-imports
import { defaultKnipConfig, defineKnipConfig } from "../../src/index.js";

describe("knip defaults", () => {
    describe("defaultKnipConfig", () => {
        it("should have a $schema field", () => {
            expect(defaultKnipConfig.$schema).toBe(
                "https://unpkg.com/knip@5/schema.json",
            );
        });

        it("should disable eslint plugin", () => {
            expect(defaultKnipConfig.eslint).toBe(false);
        });

        it("should have default entry and project arrays", () => {
            expect(defaultKnipConfig.entry).toEqual(["knip.config.ts"]);
            expect(defaultKnipConfig.project).toEqual([
                "knip.config.ts",
                "eslint.config.mjs",
            ]);
        });

        it("should have ignore patterns for common generated files", () => {
            const ignore = defaultKnipConfig.ignore as string[];
            expect(ignore).toContain("**/dist/**");
            expect(ignore).toContain("**/knip.config.ts");
            expect(ignore).toContain("**/eslint.config.mjs");
            expect(ignore).toContain("**/.storybook/**");
        });

        it("should have rules with expected severity levels", () => {
            const rules = defaultKnipConfig.rules as Record<string, string>;
            expect(rules.dependencies).toBe("error");
            expect(rules.unlisted).toBe("error");
            expect(rules.files).toBe("error");
            expect(rules.exports).toBe("error");
            expect(rules.classMembers).toBe("off");
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

            // Should have both defaults and overrides
            expect(ignore).toContain("**/dist/**");
            expect(ignore).toContain("**/custom/**");
            expect(ignoreBinaries).toContain("my-bin");
        });

        it("should deep merge nested objects", () => {
            const config = defineKnipConfig({
                rules: {
                    classMembers: "error",
                },
            });

            const rules = config.rules as Record<string, string>;
            expect(rules.classMembers).toBe("error"); // overridden
            expect(rules.dependencies).toBe("error"); // kept from default
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
});
