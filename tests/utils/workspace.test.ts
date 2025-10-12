import type { TempWorkspace } from "../helpers/workspace.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// eslint-disable-next-line rad/no-incorrect-pkg-imports
import { findWorkspaceRoot, getWorkspaceInfo, loadPackageJson } from "../../src/index.js";
import { createTempWorkspace } from "../helpers/workspace.js";

describe("workspace utilities", () => {
    let workspace: TempWorkspace;

    afterEach(async () => {
        if (workspace) {
            await workspace.cleanup();
        }
    });

    describe("findWorkspaceRoot", () => {
        it("should find workspace root with pnpm-workspace.yaml", async () => {
            workspace = await createTempWorkspace();

            const root = await findWorkspaceRoot(workspace.root);
            expect(root).toBe(workspace.root);
        });

        it("should find workspace root from nested directory", async () => {
            workspace = await createTempWorkspace({
                packages: {
                    "pkg-a": { name: "pkg-a" },
                },
            });

            const nestedPath = workspace.path("packages", "pkg-a");
            const root = await findWorkspaceRoot(nestedPath);
            expect(root).toBe(workspace.root);
        });

        it("should throw when not in a pnpm workspace", async () => {
            // Create a completely isolated temp directory (not inside workspace)
            const { mkdtemp, rm } = await import("node:fs/promises");
            const { tmpdir } = await import("node:os");
            const { join } = await import("node:path");

            const isolatedDir = await mkdtemp(join(tmpdir(), "isolated-test-"));

            try {
                await expect(findWorkspaceRoot(isolatedDir)).rejects.toThrow(
                    "Not in a pnpm workspace",
                );
            } finally {
                await rm(isolatedDir, { recursive: true, force: true });
            }
        });
    });

    describe("getWorkspaceInfo", () => {
        it("should parse workspace and load all packages", async () => {
            workspace = await createTempWorkspace({
                packages: {
                    "pkg-a": {
                        name: "pkg-a",
                        version: "1.0.0",
                        scripts: { test: "vitest" },
                    },
                    "pkg-b": {
                        name: "pkg-b",
                        version: "2.0.0",
                        dependencies: { zod: "^4.0.0" },
                    },
                },
            });

            const info = await getWorkspaceInfo(workspace.root);

            expect(info.root).toBe(workspace.root);
            expect(info.packages).toHaveLength(2);
            expect(info.packages[0].name).toBe("pkg-a");
            expect(info.packages[0].version).toBe("1.0.0");
            expect(info.packages[0].scripts).toEqual({ test: "vitest" });
            expect(info.packages[1].name).toBe("pkg-b");
            expect(info.packages[1].dependencies).toEqual({ zod: "^4.0.0" });
        });

        it("should handle workspace with no packages", async () => {
            workspace = await createTempWorkspace({
                packages: {},
            });

            const info = await getWorkspaceInfo(workspace.root);

            expect(info.root).toBe(workspace.root);
            expect(info.packages).toHaveLength(0);
        });

        it("should include lockfile and workspace file paths", async () => {
            workspace = await createTempWorkspace();

            const info = await getWorkspaceInfo(workspace.root);

            expect(info.lockfile).toBe(workspace.path("pnpm-lock.yaml"));
            expect(info.workspaceFile).toBe(workspace.path("pnpm-workspace.yaml"));
        });

        it("should load package dependencies and devDependencies", async () => {
            workspace = await createTempWorkspace({
                packages: {
                    "pkg-a": {
                        name: "pkg-a",
                        version: "1.0.0",
                        dependencies: {
                            zod: "^4.0.0",
                            react: "^18.0.0",
                        },
                        devDependencies: {
                            vitest: "^2.0.0",
                            typescript: "^5.0.0",
                        },
                    },
                },
            });

            const info = await getWorkspaceInfo(workspace.root);

            expect(info.packages[0].dependencies).toEqual({
                zod: "^4.0.0",
                react: "^18.0.0",
            });
            expect(info.packages[0].devDependencies).toEqual({
                vitest: "^2.0.0",
                typescript: "^5.0.0",
            });
        });

        it("should set private flag correctly", async () => {
            workspace = await createTempWorkspace({
                packages: {
                    "public-pkg": {
                        name: "public-pkg",
                        version: "1.0.0",
                    },
                    "private-pkg": {
                        name: "private-pkg",
                        version: "1.0.0",
                        private: true,
                    },
                },
            });

            const info = await getWorkspaceInfo(workspace.root);

            const publicPkg = info.packages.find(p => p.name === "public-pkg");
            const privatePkg = info.packages.find(p => p.name === "private-pkg");

            expect(publicPkg?.private).toBe(false);
            expect(privatePkg?.private).toBe(true);
        });
    });

    describe("loadPackageJson", () => {
        beforeEach(async () => {
            workspace = await createTempWorkspace({
                packages: {
                    "test-pkg": {
                        name: "@test/pkg",
                        version: "2.5.0",
                        private: true,
                        scripts: {
                            test: "vitest",
                            build: "tsup",
                        },
                        dependencies: {
                            lodash: "^4.0.0",
                        },
                    },
                },
            });
        });

        it("should load package.json correctly", async () => {
            const pkg = await loadPackageJson(workspace.path("packages", "test-pkg"));

            expect(pkg.name).toBe("@test/pkg");
            expect(pkg.version).toBe("2.5.0");
            expect(pkg.private).toBe(true);
            expect(pkg.scripts).toEqual({
                test: "vitest",
                build: "tsup",
            });
            expect(pkg.dependencies).toEqual({
                lodash: "^4.0.0",
            });
        });

        it("should include package path", async () => {
            const pkg = await loadPackageJson(workspace.path("packages", "test-pkg"));

            expect(pkg.path).toBe(workspace.path("packages", "test-pkg"));
        });

        it("should throw when package.json is missing", async () => {
            await expect(
                loadPackageJson(workspace.path("nonexistent")),
            ).rejects.toThrow();
        });

        it("should handle missing optional fields", async () => {
            await workspace.writeJSON("packages/minimal/package.json", {
                name: "minimal",
                version: "1.0.0",
            });

            const pkg = await loadPackageJson(workspace.path("packages", "minimal"));

            expect(pkg.name).toBe("minimal");
            expect(pkg.version).toBe("1.0.0");
            expect(pkg.dependencies).toBeUndefined();
            expect(pkg.devDependencies).toBeUndefined();
            expect(pkg.scripts).toBeUndefined();
        });
    });
});
