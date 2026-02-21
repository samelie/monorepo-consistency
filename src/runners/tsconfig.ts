import type { TsconfigConfig } from "../config/schema";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";
import process from "node:process";
import glob from "fast-glob";
import merge from "lodash/merge";
import {
    BASE_EXCLUDE,
    BASE_INCLUDE,
    BASE_WATCH_OPTIONS,
    BUILDER_COMPILER_OPTIONS,
    NODE_COMPILER_OPTIONS,
    SUPERBASE_COMPILER_OPTIONS,
    TYPECHECK_COMPILER_OPTIONS,
    WEB_COMPILER_OPTIONS,
} from "../domains/tsconfig/defaults";

/**
 * TypeScript config generation options
 */
export interface TsconfigGenerateOptions {
    /** Root directory to scan */
    rootDir: string;

    /** Config types to generate */
    types?: TsconfigType[];

    /** Dry run - don't write files */
    dryRun?: boolean;

    /** Force overwrite existing configs */
    force?: boolean;

    /** Verbose logging */
    verbose?: boolean;

    /** Schema config from ConfigManager */
    schemaConfig?: TsconfigConfig;
}

export type TsconfigType = "web" | "node" | "builder";

interface TsconfigGenerateResult {
    success: boolean;
    generated: GeneratedConfig[];
    errors: GenerationError[];
}

interface GeneratedConfig {
    type: TsconfigType;
    path: string;
    basePath: string;
}

interface GenerationError {
    path: string;
    error: string;
}

/**
 * Safely read and parse a JSON file, returning {} on failure
 */
function readJsonSafe(filePath: string): Record<string, unknown> {
    try {
        return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    } catch {
        return {};
    }
}

/**
 * Build the base tsconfig (superbase + base) shared by web/node types
 */
function buildBaseConfig(schema?: TsconfigConfig): Record<string, unknown> {
    const base: Record<string, unknown> = {
        compilerOptions: { ...SUPERBASE_COMPILER_OPTIONS },
        include: [...BASE_INCLUDE],
        exclude: [...BASE_EXCLUDE],
        watchOptions: { ...BASE_WATCH_OPTIONS },
    };

    // Apply schema.tsconfig.base overrides
    if (schema?.base) {
        return merge({}, base, schema.base);
    }
    return base;
}

/**
 * Build a web tsconfig
 * Merge: base → WEB defaults → schema.web → local stub
 */
function buildWebConfig(
    localStubPath: string,
    schema?: TsconfigConfig,
): Record<string, unknown> {
    let config = buildBaseConfig(schema);
    config = merge({}, config, { compilerOptions: { ...WEB_COMPILER_OPTIONS } });
    if (schema?.web) {
        config = merge({}, config, schema.web);
    }
    if (existsSync(localStubPath)) {
        const local = readJsonSafe(localStubPath);
        const { extends: _, ...rest } = local;
        config = merge({}, config, rest);
    }
    delete config.extends;
    return config;
}

/**
 * Build a node tsconfig
 * Merge: base → NODE defaults → schema.node → local stub
 */
function buildNodeConfig(
    localStubPath: string,
    schema?: TsconfigConfig,
): Record<string, unknown> {
    let config = buildBaseConfig(schema);
    config = merge({}, config, { compilerOptions: { ...NODE_COMPILER_OPTIONS } });
    if (schema?.node) {
        config = merge({}, config, schema.node);
    }
    if (existsSync(localStubPath)) {
        const local = readJsonSafe(localStubPath);
        const { extends: _, ...rest } = local;
        config = merge({}, config, rest);
    }
    delete config.extends;
    return config;
}

/**
 * Build a builder tsconfig (standalone — no superbase/base)
 * Merge: BUILDER defaults → schema.builder → local stub
 */
function buildBuilderConfig(
    localStubPath: string,
    schema?: TsconfigConfig,
): Record<string, unknown> {
    let config: Record<string, unknown> = {
        compilerOptions: { ...BUILDER_COMPILER_OPTIONS },
    };
    if (schema?.builder) {
        config = merge({}, config, schema.builder);
    }
    if (existsSync(localStubPath)) {
        const local = readJsonSafe(localStubPath);
        const { extends: _, ...rest } = local;
        config = merge({}, config, rest);
    }
    delete config.extends;
    delete (config as Record<string, unknown>).references;
    delete (config as Record<string, unknown>).watchOptions;
    return config;
}

/**
 * Build a typecheck tsconfig
 * Merge: TYPECHECK defaults → schema.typecheck
 */
function buildTypecheckConfig(schema?: TsconfigConfig): Record<string, unknown> {
    const config: Record<string, unknown> = {
        extends: "./tsconfig.json",
        compilerOptions: { ...TYPECHECK_COMPILER_OPTIONS },
    };
    if (schema?.typecheck?.compilerOptions) {
        config.compilerOptions = merge(
            {},
            config.compilerOptions,
            schema.typecheck.compilerOptions,
        );
    }
    return config;
}

/**
 * Generate TypeScript configurations for all packages in the monorepo
 */
export async function generateTsconfigs(
    options: TsconfigGenerateOptions,
): Promise<TsconfigGenerateResult> {
    const {
        rootDir,
        types,
        dryRun = false,
        force: _force = false,
        verbose = false,
        schemaConfig,
    } = options;

    const result: TsconfigGenerateResult = {
        success: true,
        generated: [],
        errors: [],
    };

    const excludePatterns = schemaConfig?.excludePatterns ?? [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
    ];

    // Find all package.json files
    const packageJsonFiles = await glob("**/package.json", {
        cwd: rootDir,
        absolute: false,
        onlyFiles: true,
        ignore: excludePatterns,
    });

    if (verbose) {
        process.stdout.write(`${JSON.stringify(packageJsonFiles, null, 2)}\n`);
    }

    // Process each package
    for (const pjsonPath of packageJsonFiles) {
        const dir = join(rootDir, parse(pjsonPath).dir);
        const targetTs = join(dir, "tsconfig.json");
        const targetTypecheck = join(dir, "tsconfig.typecheck.json");

        // Check for local type-signal stub files
        const localWebTs = join(dir, "web.tsconfig.json");
        const localNodeTs = join(dir, "node.tsconfig.json");
        const localBuilderTs = join(dir, "builder.tsconfig.json");

        let generatedConfig = false;

        // Node config (checked first — node takes priority if both exist)
        if (
            existsSync(localNodeTs)
            && (!types || types.includes("node"))
        ) {
            try {
                const ts = buildNodeConfig(localNodeTs, schemaConfig);

                if (verbose) {
                    process.stdout.write(`writing Node ${targetTs} (internal defaults)\n`);
                }

                if (!dryRun) {
                    writeFileSync(targetTs, JSON.stringify(ts, null, 4), "utf-8");
                }

                result.generated.push({
                    type: "node",
                    path: targetTs,
                    basePath: localNodeTs,
                });

                generatedConfig = true;
            } catch (error) {
                result.errors.push({ path: targetTs, error: String(error) });
                result.success = false;
            }
        }

        // Web config
        if (
            !generatedConfig
            && existsSync(localWebTs)
            && (!types || types.includes("web"))
        ) {
            try {
                const ts = buildWebConfig(localWebTs, schemaConfig);

                if (verbose) {
                    process.stdout.write(`writing Web ${targetTs} (internal defaults)\n`);
                }

                if (!dryRun) {
                    writeFileSync(targetTs, JSON.stringify(ts, null, 4), "utf-8");
                }

                result.generated.push({
                    type: "web",
                    path: targetTs,
                    basePath: localWebTs,
                });

                generatedConfig = true;
            } catch (error) {
                result.errors.push({ path: targetTs, error: String(error) });
                result.success = false;
            }
        }

        // Builder config (writes to builder.tsconfig.json, not tsconfig.json)
        if (
            existsSync(localBuilderTs)
            && (!types || types.includes("builder"))
        ) {
            try {
                const ts = buildBuilderConfig(localBuilderTs, schemaConfig);

                if (verbose) {
                    process.stdout.write(`writing Builder ${localBuilderTs} (internal defaults)\n`);
                }

                if (!dryRun) {
                    writeFileSync(localBuilderTs, JSON.stringify(ts, null, 4), "utf-8");
                }

                result.generated.push({
                    type: "builder",
                    path: localBuilderTs,
                    basePath: localBuilderTs,
                });

                generatedConfig = true;
            } catch (error) {
                result.errors.push({ path: localBuilderTs, error: String(error) });
                result.success = false;
            }
        }

        // Write typecheck config (only if we generated a main tsconfig.json)
        if (generatedConfig) {
            const generateTypecheck = schemaConfig?.generateTypecheck ?? true;

            if (generateTypecheck) {
                if (verbose) {
                    process.stdout.write(`writing TypeCheck ${targetTypecheck}\n`);
                }

                if (!dryRun) {
                    const typecheckConfig = buildTypecheckConfig(schemaConfig);
                    writeFileSync(
                        targetTypecheck,
                        JSON.stringify(typecheckConfig, null, 4),
                        "utf-8",
                    );
                }
            }
        }
    }

    return result;
}

// Re-export build functions for testing
export {
    buildBaseConfig,
    buildBuilderConfig,
    buildNodeConfig,
    buildTypecheckConfig,
    buildWebConfig,
};
