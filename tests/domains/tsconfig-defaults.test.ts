import { describe, expect, it } from "vitest";
// eslint-disable-next-line rad/no-incorrect-pkg-imports
import {
    buildBaseConfig,
    buildBuilderConfig,
    buildNodeConfig,
    buildTypecheckConfig,
    buildWebConfig,
} from "../../src/runners/tsconfig.js";
import {
    BASE_EXCLUDE,
    BASE_INCLUDE,
    BASE_WATCH_OPTIONS,
    BUILDER_COMPILER_OPTIONS,
    NODE_COMPILER_OPTIONS,
    SUPERBASE_COMPILER_OPTIONS,
    TYPECHECK_COMPILER_OPTIONS,
    WEB_COMPILER_OPTIONS,
} from "../../src/domains/tsconfig/defaults.js";

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
            // Include merged (lodash merge replaces arrays by index)
            expect(config.include).toEqual(["lib"]);
        });
    });

    describe("buildWebConfig", () => {
        it("should produce web config with merged WEB compilerOptions", () => {
            const config = buildWebConfig("/nonexistent/web.tsconfig.json");
            const co = config.compilerOptions as Record<string, unknown>;
            // WEB overrides lib by index — shorter array leaves trailing superbase entries
            const lib = co.lib as string[];
            expect(lib.slice(0, 4)).toEqual([...WEB_COMPILER_OPTIONS.lib]);
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
            // NODE lib ["ESNext"] is shorter than superbase lib — trailing entries remain
            const lib = co.lib as string[];
            expect(lib[0]).toBe("ESNext");
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

            // Web-specific overrides (lodash merge by index — trailing superbase lib entries remain)
            expect(co.types).toEqual(["vite/client", "vitest/globals"]);
            const lib = co.lib as string[];
            expect(lib.slice(0, 4)).toEqual(["ES2022", "DOM", "DOM.Iterable", "WebWorker"]);

            // Base include/exclude
            expect(config.include).toEqual(["src"]);
            expect(config.exclude).toEqual(["node_modules", "dist", "build"]);
        });

        it("node: superbase + base + node = buildNodeConfig", () => {
            const config = buildNodeConfig("/nonexistent/node.tsconfig.json");
            const co = config.compilerOptions as Record<string, unknown>;

            expect(co.types).toEqual(["node"]);
            // lodash merge by index — ["ESNext"] overwrites first element, rest from superbase remain
            const lib = co.lib as string[];
            expect(lib[0]).toBe("ESNext");
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
});
