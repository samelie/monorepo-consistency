import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    BASE_EXCLUDE,
    BASE_INCLUDE,
    BASE_WATCH_OPTIONS,
    buildBaseConfig,
    buildBuilderConfig,
    BUILDER_COMPILER_OPTIONS,
    buildNodeConfig,
    buildTypecheckConfig,
    buildWebConfig,
    NODE_COMPILER_OPTIONS,
    SUPERBASE_COMPILER_OPTIONS,
    TYPECHECK_COMPILER_OPTIONS,
    WEB_COMPILER_OPTIONS,
} from "@adddog/monorepo-consistency";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("tsconfig internal defaults", () => {
    describe("buildBaseConfig", () => {
        it("should produce superbase compilerOptions + base include/exclude/watch", () => {
            const config = buildBaseConfig();
            expect(config.compilerOptions).toEqual(SUPERBASE_COMPILER_OPTIONS);
            expect(config.include).toEqual([...BASE_INCLUDE]);
            expect(config.exclude).toEqual([...BASE_EXCLUDE]);
            expect(config.watchOptions).toEqual(BASE_WATCH_OPTIONS);
        });

        it("should apply schema base overrides", () => {
            const config = buildBaseConfig({
                base: {
                    compilerOptions: { target: "ES2022", strict: false },
                    include: ["lib"],
                },
            } as never);
            const co = config.compilerOptions as Record<string, unknown>;
            expect(co.target).toBe("ES2022");
            expect(co.strict).toBe(false);
            // Superbase values still present
            expect(co.resolveJsonModule).toBe(true);
            // Include replaced (array-replace semantics)
            expect(config.include).toEqual(["lib"]);
        });
    });

    describe("buildWebConfig", () => {
        it("should produce web config with merged WEB compilerOptions", () => {
            const config = buildWebConfig("/nonexistent/web.tsconfig.json");
            const co = config.compilerOptions as Record<string, unknown>;
            // WEB lib fully replaces superbase lib (array-replace semantics)
            expect(co.lib).toEqual([...WEB_COMPILER_OPTIONS.lib]);
            expect(co.types).toEqual([...WEB_COMPILER_OPTIONS.types]);
            // Still has superbase options
            expect(co.strict).toBe(true);
            expect(co.resolveJsonModule).toBe(true);
        });

        it("should apply schema web overrides on top of base", () => {
            const config = buildWebConfig("/nonexistent/web.tsconfig.json", {
                web: {
                    compilerOptions: { jsx: "react-jsx" },
                },
            } as never);
            const co = config.compilerOptions as Record<string, unknown>;
            expect(co.jsx).toBe("react-jsx");
            expect(co.types).toEqual([...WEB_COMPILER_OPTIONS.types]);
        });
    });

    describe("buildNodeConfig", () => {
        it("should produce node config with merged NODE compilerOptions", () => {
            const config = buildNodeConfig("/nonexistent/node.tsconfig.json");
            const co = config.compilerOptions as Record<string, unknown>;
            expect(co.types).toEqual([...NODE_COMPILER_OPTIONS.types]);
            // NODE lib fully replaces superbase lib (array-replace semantics)
            expect(co.lib).toEqual([...NODE_COMPILER_OPTIONS.lib]);
            expect(co.strict).toBe(true);
        });

        it("should apply schema node overrides", () => {
            const config = buildNodeConfig("/nonexistent/node.tsconfig.json", {
                node: {
                    compilerOptions: { outDir: "dist" },
                },
            } as never);
            const co = config.compilerOptions as Record<string, unknown>;
            expect(co.outDir).toBe("dist");
            expect(co.types).toEqual([...NODE_COMPILER_OPTIONS.types]);
        });
    });

    describe("buildBuilderConfig", () => {
        it("should use builder defaults without superbase/base inheritance", () => {
            const config = buildBuilderConfig("/nonexistent/builder.tsconfig.json");
            const co = config.compilerOptions as Record<string, unknown>;
            expect(co).toEqual(BUILDER_COMPILER_OPTIONS);
            // Should NOT have superbase options
            expect(co.strict).toBeUndefined();
            expect(config.include).toBeUndefined();
            expect(config.watchOptions).toBeUndefined();
        });

        it("should apply schema builder overrides", () => {
            const config = buildBuilderConfig("/nonexistent/builder.tsconfig.json", {
                builder: {
                    compilerOptions: { outDir: "lib" },
                },
            } as never);
            const co = config.compilerOptions as Record<string, unknown>;
            expect(co.outDir).toBe("lib");
            expect(co.composite).toBe(true);
        });
    });

    describe("buildTypecheckConfig", () => {
        it("should produce typecheck defaults", () => {
            const config = buildTypecheckConfig();
            expect(config.extends).toBe("./tsconfig.json");
            expect(config.compilerOptions).toEqual(TYPECHECK_COMPILER_OPTIONS);
        });

        it("should apply schema typecheck overrides", () => {
            const config = buildTypecheckConfig({
                typecheck: {
                    compilerOptions: { strict: true },
                },
            } as never);
            const co = config.compilerOptions as Record<string, unknown>;
            expect(co.noEmit).toBe(true);
            expect(co.strict).toBe(true);
        });
    });

    describe("matches packages/config chain output", () => {
        it("web: superbase + base + web = buildWebConfig", () => {
            const config = buildWebConfig("/nonexistent/web.tsconfig.json");
            const co = config.compilerOptions as Record<string, unknown>;

            // Verify key superbase options carried through
            expect(co.resolveJsonModule).toBe(true);
            expect(co.verbatimModuleSyntax).toBe(true);
            expect(co.moduleResolution).toBe("bundler");
            expect(co.erasableSyntaxOnly).toBe(true);

            // Web-specific overrides (array-replace semantics)
            expect(co.types).toEqual(["vite/client", "vitest/globals"]);
            expect(co.lib).toEqual(["ES2022", "DOM", "DOM.Iterable", "WebWorker"]);

            // Base include/exclude
            expect(config.include).toEqual(["src"]);
            expect(config.exclude).toEqual(["node_modules", "dist", "build"]);
        });

        it("node: superbase + base + node = buildNodeConfig", () => {
            const config = buildNodeConfig("/nonexistent/node.tsconfig.json");
            const co = config.compilerOptions as Record<string, unknown>;

            expect(co.types).toEqual(["node"]);
            // NODE lib fully replaces superbase lib (array-replace semantics)
            expect(co.lib).toEqual(["ESNext"]);
            expect(co.moduleDetection).toBe("force");
            expect(co.module).toBe("ESNext");
            expect(co.moduleResolution).toBe("bundler");

            // Superbase
            expect(co.strict).toBe(true);
            expect(co.isolatedModules).toBe(true);
        });

        it("builder: standalone", () => {
            const config = buildBuilderConfig("/nonexistent/builder.tsconfig.json");
            expect(config.compilerOptions).toEqual({
                composite: true,
                noEmit: false,
                skipLibCheck: true,
                target: "ES2020",
                module: "ESNext",
                moduleResolution: "bundler",
                allowSyntheticDefaultImports: true,
            });
        });
    });

    describe("array-replace and null-deletion semantics", () => {
        let tmpDir: string;

        beforeAll(() => {
            tmpDir = mkdtempSync(join(tmpdir(), "tsconfig-test-"));
        });

        afterAll(() => {
            rmSync(tmpDir, { recursive: true, force: true });
        });

        it("empty array in local stub clears default include", () => {
            const stubPath = join(tmpDir, "node-empty-include.tsconfig.json");
            writeFileSync(stubPath, JSON.stringify({ include: [] }));
            const config = buildNodeConfig(stubPath);
            expect(config.include).toEqual([]);
        });

        it("non-empty array in local stub replaces default include", () => {
            const stubPath = join(tmpDir, "node-custom-include.tsconfig.json");
            writeFileSync(stubPath, JSON.stringify({ include: ["lib", "scripts"] }));
            const config = buildNodeConfig(stubPath);
            expect(config.include).toEqual(["lib", "scripts"]);
        });

        it("null in local stub removes key from output", () => {
            const stubPath = join(tmpDir, "node-null-watch.tsconfig.json");
            writeFileSync(stubPath, JSON.stringify({ watchOptions: null }));
            const config = buildNodeConfig(stubPath);
            expect(config.watchOptions).toBeUndefined();
        });

        it("null in schema overrides removes key from output", () => {
            const config = buildBaseConfig({
                base: { watchOptions: null },
            } as never);
            expect(config.watchOptions).toBeUndefined();
            // Other keys still present
            expect(config.include).toEqual([...BASE_INCLUDE]);
        });

        it("empty array in web local stub clears default include", () => {
            const stubPath = join(tmpDir, "web-empty-include.tsconfig.json");
            writeFileSync(stubPath, JSON.stringify({ include: [] }));
            const config = buildWebConfig(stubPath);
            expect(config.include).toEqual([]);
        });
    });
});
