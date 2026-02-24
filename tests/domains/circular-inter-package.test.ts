import type { PackageInfo } from "@adddog/..";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line rad/no-incorrect-pkg-imports
import { detectInterPackageCycles } from "../../src/index.js";

function makePkg(
    name: string,
    deps?: Record<string, string>,
    devDeps?: Record<string, string>,
): PackageInfo {
    return {
        name,
        path: `/fake/${name}`,
        version: "1.0.0",
        private: true,
        dependencies: deps,
        devDependencies: devDeps,
    };
}

describe("detectInterPackageCycles", () => {
    it("should return empty for a linear chain", () => {
        const packages = [
            makePkg("@pkg/a", { "@pkg/b": "workspace:*" }),
            makePkg("@pkg/b", { "@pkg/c": "workspace:*" }),
            makePkg("@pkg/c"),
        ];
        expect(detectInterPackageCycles(packages)).toEqual([]);
    });

    it("should detect a simple A <-> B cycle", () => {
        const packages = [
            makePkg("@pkg/a", { "@pkg/b": "workspace:*" }),
            makePkg("@pkg/b", { "@pkg/a": "workspace:*" }),
        ];
        const cycles = detectInterPackageCycles(packages);
        expect(cycles.length).toBe(1);
        expect(cycles[0]).toContain("@pkg/a");
        expect(cycles[0]).toContain("@pkg/b");
    });

    it("should detect A -> B -> C -> A triangle", () => {
        const packages = [
            makePkg("@pkg/a", { "@pkg/b": "workspace:*" }),
            makePkg("@pkg/b", { "@pkg/c": "workspace:*" }),
            makePkg("@pkg/c", { "@pkg/a": "workspace:*" }),
        ];
        const cycles = detectInterPackageCycles(packages);
        expect(cycles.length).toBe(1);
        expect(cycles[0]).toHaveLength(3);
        expect(cycles[0]).toContain("@pkg/a");
        expect(cycles[0]).toContain("@pkg/b");
        expect(cycles[0]).toContain("@pkg/c");
    });

    it("should ignore non-workspace deps", () => {
        const packages = [
            makePkg("@pkg/a", { "@pkg/b": "workspace:*", "lodash": "^4.17.0" }),
            makePkg("@pkg/b", { lodash: "^4.17.0" }),
        ];
        expect(detectInterPackageCycles(packages)).toEqual([]);
    });

    it("should consider devDependencies", () => {
        const packages = [
            makePkg("@pkg/a", { "@pkg/b": "workspace:*" }),
            makePkg("@pkg/b", undefined, { "@pkg/a": "workspace:*" }),
        ];
        const cycles = detectInterPackageCycles(packages);
        expect(cycles.length).toBe(1);
    });

    it("should handle disconnected subgraphs", () => {
        const packages = [
            makePkg("@pkg/a", { "@pkg/b": "workspace:*" }),
            makePkg("@pkg/b"),
            makePkg("@pkg/x", { "@pkg/y": "workspace:*" }),
            makePkg("@pkg/y", { "@pkg/x": "workspace:*" }),
        ];
        const cycles = detectInterPackageCycles(packages);
        expect(cycles.length).toBe(1);
        expect(cycles[0]).toContain("@pkg/x");
        expect(cycles[0]).toContain("@pkg/y");
    });

    it("should handle self-referencing package", () => {
        const packages = [
            makePkg("@pkg/a", { "@pkg/a": "workspace:*" }),
        ];
        const cycles = detectInterPackageCycles(packages);
        expect(cycles.length).toBe(1);
        expect(cycles[0]).toEqual(["@pkg/a"]);
    });

    it("should handle empty package list", () => {
        expect(detectInterPackageCycles([])).toEqual([]);
    });

    it("should handle packages with no deps", () => {
        const packages = [
            makePkg("@pkg/a"),
            makePkg("@pkg/b"),
        ];
        expect(detectInterPackageCycles(packages)).toEqual([]);
    });
});
