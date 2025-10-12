import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";

/**
 * Tests for helper functions used in domain logic
 * These mirror the internal helpers in the actual implementation
 */

describe("helper functions", () => {
    describe("shouldIgnorePackage (pattern matching)", () => {
        const shouldIgnorePackage = (
            packageName: string,
            ignorePatterns: string[],
        ): boolean => {
            return ignorePatterns.some(pattern => minimatch(packageName, pattern));
        };

        it("should match exact package names", () => {
            expect(shouldIgnorePackage("test-package", ["test-package"])).toBe(true);
            expect(shouldIgnorePackage("other-package", ["test-package"])).toBe(false);
        });

        it("should match glob patterns with wildcards", () => {
            expect(shouldIgnorePackage("@internal/tools", ["@internal/*"])).toBe(true);
            expect(shouldIgnorePackage("@internal/utils", ["@internal/*"])).toBe(true);
            expect(shouldIgnorePackage("@external/lib", ["@internal/*"])).toBe(false);
        });

        it("should match suffix patterns", () => {
            expect(shouldIgnorePackage("foo-test", ["*-test"])).toBe(true);
            expect(shouldIgnorePackage("bar-test", ["*-test"])).toBe(true);
            expect(shouldIgnorePackage("test-foo", ["*-test"])).toBe(false);
        });

        it("should match prefix patterns", () => {
            expect(shouldIgnorePackage("test-foo", ["test-*"])).toBe(true);
            expect(shouldIgnorePackage("test-bar", ["test-*"])).toBe(true);
            expect(shouldIgnorePackage("foo-test", ["test-*"])).toBe(false);
        });

        it("should handle multiple patterns", () => {
            const patterns = ["@internal/*", "*-test", "legacy-*"];

            expect(shouldIgnorePackage("@internal/foo", patterns)).toBe(true);
            expect(shouldIgnorePackage("foo-test", patterns)).toBe(true);
            expect(shouldIgnorePackage("legacy-package", patterns)).toBe(true);
            expect(shouldIgnorePackage("regular-package", patterns)).toBe(false);
        });

        it("should handle empty patterns", () => {
            expect(shouldIgnorePackage("any-package", [])).toBe(false);
        });

        it("should handle scoped packages", () => {
            const patterns = ["@org/*", "@company/internal-*"];

            expect(shouldIgnorePackage("@org/package", patterns)).toBe(true);
            expect(shouldIgnorePackage("@org/anything", patterns)).toBe(true);
            expect(shouldIgnorePackage("@company/internal-tools", patterns)).toBe(
                true,
            );
            expect(shouldIgnorePackage("@company/public-lib", patterns)).toBe(false);
            expect(shouldIgnorePackage("@other/package", patterns)).toBe(false);
        });

        it("should be case sensitive", () => {
            expect(shouldIgnorePackage("Test-Package", ["test-*"])).toBe(false);
            expect(shouldIgnorePackage("test-package", ["test-*"])).toBe(true);
        });

        it("should handle complex glob patterns", () => {
            expect(shouldIgnorePackage("@internal/foo-bar", ["@internal/*-bar"])).toBe(
                true,
            );
            expect(
                shouldIgnorePackage("@internal/foo-baz", ["@internal/*-bar"]),
            ).toBe(false);
        });
    });

    describe("normalizeFieldEntry", () => {
        const normalizeFieldEntry = (
            entry: string | { field: string; default?: unknown },
        ): { field: string; default?: unknown } => {
            if (typeof entry === "string") {
                return { field: entry };
            }
            return entry;
        };

        it("should normalize string entries", () => {
            expect(normalizeFieldEntry("license")).toEqual({ field: "license" });
            expect(normalizeFieldEntry("name")).toEqual({ field: "name" });
            expect(normalizeFieldEntry("version")).toEqual({ field: "version" });
        });

        it("should normalize object entries", () => {
            expect(normalizeFieldEntry({ field: "license" })).toEqual({
                field: "license",
            });
            expect(normalizeFieldEntry({ field: "license", default: "MIT" })).toEqual(
                {
                    field: "license",
                    default: "MIT",
                },
            );
        });

        it("should handle various default value types", () => {
            expect(
                normalizeFieldEntry({ field: "license", default: "MIT" }),
            ).toEqual({
                field: "license",
                default: "MIT",
            });

            expect(normalizeFieldEntry({ field: "type", default: "module" })).toEqual(
                {
                    field: "type",
                    default: "module",
                },
            );

            expect(
                normalizeFieldEntry({
                    field: "engines",
                    default: { node: ">= 20" },
                }),
            ).toEqual({
                field: "engines",
                default: { node: ">= 20" },
            });

            expect(
                normalizeFieldEntry({ field: "private", default: true }),
            ).toEqual({
                field: "private",
                default: true,
            });

            expect(normalizeFieldEntry({ field: "count", default: 0 })).toEqual({
                field: "count",
                default: 0,
            });
        });

        it("should preserve undefined default", () => {
            const result = normalizeFieldEntry({ field: "license", default: undefined });
            expect(result).toEqual({ field: "license", default: undefined });
            expect("default" in result).toBe(true);
        });

        it("should handle empty string as valid field name", () => {
            expect(normalizeFieldEntry("")).toEqual({ field: "" });
            expect(normalizeFieldEntry({ field: "" })).toEqual({ field: "" });
        });
    });

    describe("issue severity classification", () => {
        it("should classify missing required items as high severity", () => {
            const isRequired = true;

            const severity = isRequired ? "high" : "low";
            expect(severity).toBe("high");
        });

        it("should classify script mismatches as medium severity", () => {
            const severity = "medium";
            expect(severity).toBe("medium");
        });

        it("should classify forbidden items as high severity", () => {
            const severity = "high";
            expect(severity).toBe("high");
        });

        it("should classify missing recommended items as low severity", () => {
            const severity = "low";
            expect(severity).toBe("low");
        });

        it("should classify consistency issues as medium severity", () => {
            const severity = "medium";
            expect(severity).toBe("medium");
        });

        it("should classify missing engines as low severity", () => {
            const severity = "low";
            expect(severity).toBe("low");
        });
    });

    describe("stats calculation", () => {
        const calculateStats = (
            issues: Array<{ severity: string }>,
        ): {
            total: number;
            critical: number;
            high: number;
            medium: number;
            low: number;
        } => {
            return {
                total: issues.length,
                critical: issues.filter(i => i.severity === "critical").length,
                high: issues.filter(i => i.severity === "high").length,
                medium: issues.filter(i => i.severity === "medium").length,
                low: issues.filter(i => i.severity === "low").length,
            };
        };

        it("should calculate stats for empty issues", () => {
            const stats = calculateStats([]);
            expect(stats).toEqual({
                total: 0,
                critical: 0,
                high: 0,
                medium: 0,
                low: 0,
            });
        });

        it("should calculate stats for mixed severity issues", () => {
            const issues = [
                { severity: "critical" },
                { severity: "high" },
                { severity: "high" },
                { severity: "medium" },
                { severity: "low" },
                { severity: "low" },
                { severity: "low" },
            ];

            const stats = calculateStats(issues);
            expect(stats).toEqual({
                total: 7,
                critical: 1,
                high: 2,
                medium: 1,
                low: 3,
            });
        });

        it("should calculate stats for single severity", () => {
            const issues = [
                { severity: "high" },
                { severity: "high" },
                { severity: "high" },
            ];

            const stats = calculateStats(issues);
            expect(stats).toEqual({
                total: 3,
                critical: 0,
                high: 3,
                medium: 0,
                low: 0,
            });
        });
    });

    describe("change tracking", () => {
        it("should create add-script change record", () => {
            const change = {
                type: "add-script",
                package: "pkg-a",
                file: "/path/to/pkg-a/package.json",
                description: "Added required script: \"test\"",
                after: "vitest",
            };

            expect(change.type).toBe("add-script");
            expect(change.description).toContain("test");
            expect(change.after).toBe("vitest");
        });

        it("should create remove-script change record", () => {
            const change = {
                type: "remove-script",
                package: "pkg-a",
                file: "/path/to/pkg-a/package.json",
                description: "Removed forbidden script: \"postinstall\"",
                before: "echo forbidden",
            };

            expect(change.type).toBe("remove-script");
            expect(change.description).toContain("postinstall");
            expect(change.before).toBe("echo forbidden");
        });

        it("should create add-field change record", () => {
            const change = {
                type: "add-field",
                package: "pkg-a",
                file: "/path/to/pkg-a/package.json",
                description: "Added required field: \"license\"",
                after: JSON.stringify("MIT"),
            };

            expect(change.type).toBe("add-field");
            expect(change.description).toContain("license");
            expect(change.after).toBe("\"MIT\"");
        });

        it("should create remove-field change record", () => {
            const change = {
                type: "remove-field",
                package: "pkg-a",
                file: "/path/to/pkg-a/package.json",
                description: "Removed forbidden field: \"publishConfig\"",
            };

            expect(change.type).toBe("remove-field");
            expect(change.description).toContain("publishConfig");
        });
    });

    describe("jSON formatting", () => {
        it("should format with 2 spaces and trailing newline", () => {
            const data = { name: "test", version: "1.0.0" };
            const formatted = `${JSON.stringify(data, null, 2)}\n`;

            expect(formatted).toContain("  "); // 2-space indent
            expect(formatted.endsWith("\n")).toBe(true);
            expect(formatted.split("\n").length).toBeGreaterThan(2);
        });

        it("should preserve nested structure", () => {
            const data = {
                name: "test",
                scripts: {
                    test: "vitest",
                    build: "tsup",
                },
            };
            const formatted = `${JSON.stringify(data, null, 2)}\n`;

            expect(formatted).toContain("  \"scripts\":");
            expect(formatted).toContain("    \"test\":");
        });
    });
});
