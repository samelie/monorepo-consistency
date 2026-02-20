import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";
import process from "node:process";
import glob from "fast-glob";
import { getTsconfig } from "get-tsconfig";
import merge from "lodash/merge.js";

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
 * TypeScript configuration templates resolved from config directory
 */
interface ResolvedTemplates {
    web: string;
    node: string;
    builder: string;
    webTs: Record<string, unknown>;
    nodeTs: Record<string, unknown>;
    builderTs: Record<string, unknown>;
}

/**
 * Possible locations for app-specific configs relative to a package
 */
const POSSIBLE_APP_CONFIG_LOCATIONS = [
    "../config",
    "../../config",
    "../packages/config",
    "../../packages/config",
    "../../../packages/config",
    "../../../../packages/config",
] as const;

/**
 * Recursively extract and merge config from extends chain
 */
function extractConfigFromExtends(
    configPath: string,
    accumulated: Record<string, unknown> = {},
): Record<string, unknown> {
    const currentConfig = JSON.parse(readFileSync(configPath, "utf-8")) as {
        extends?: string;
        [key: string]: unknown;
    };

    if (currentConfig.extends) {
        const extendedPath = join(parse(configPath).dir, currentConfig.extends);
        accumulated = extractConfigFromExtends(extendedPath, accumulated);

        const configToMerge = { ...currentConfig };
        delete configToMerge.extends;
        accumulated = merge(accumulated, configToMerge);
    } else {
        accumulated = merge(accumulated, currentConfig);
    }

    return accumulated;
}

/**
 * Find root config templates in the monorepo
 */
function findRootTemplates(packageJsonFiles: string[]): ResolvedTemplates {
    const rootTs: {
        web: string;
        node: string;
        builder: string;
    } = {
        web: "",
        node: "",
        builder: "",
    };

    // Find shortest paths to each config type (closest to root)
    for (const pjson of packageJsonFiles) {
        const dir = parse(pjson).dir;
        if (!dir.includes("/config")) continue;

        const webTs = join(dir, "web.tsconfig.json");
        const nodeTs = join(dir, "node.tsconfig.json");
        const builderTs = join(dir, "builder.tsconfig.json");

        if (existsSync(webTs) && (!rootTs.web || webTs.length < rootTs.web.length)) {
            rootTs.web = webTs;
        }
        if (existsSync(nodeTs) && (!rootTs.node || nodeTs.length < rootTs.node.length)) {
            rootTs.node = nodeTs;
        }
        if (existsSync(builderTs) && (!rootTs.builder || builderTs.length < rootTs.builder.length)) {
            rootTs.builder = builderTs;
        }
    }

    return {
        ...rootTs,
        webTs: rootTs.web ? extractConfigFromExtends(rootTs.web) : {},
        nodeTs: rootTs.node ? extractConfigFromExtends(rootTs.node) : {},
        builderTs: rootTs.builder ? extractConfigFromExtends(rootTs.builder) : {},
    };
}

/**
 * Generate TypeScript configurations for all packages in the monorepo
 */
export async function generateTsconfigs(
    options: TsconfigGenerateOptions,
): Promise<TsconfigGenerateResult> {
    const { rootDir, types, dryRun = false, force: _force = false, verbose = false } = options;

    const result: TsconfigGenerateResult = {
        success: true,
        generated: [],
        errors: [],
    };

    // Find all package.json files
    const packageJsonFiles = await glob("**/package.json", {
        cwd: rootDir,
        absolute: false,
        onlyFiles: true,
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    });

    if (verbose) {
        process.stdout.write(`${JSON.stringify(packageJsonFiles, null, 2)}\n`);
    }

    // Find root templates (need absolute paths for this)
    const absolutePackageJsonFiles = packageJsonFiles.map(p => join(rootDir, p));
    const templates = findRootTemplates(absolutePackageJsonFiles);

    // Process each package
    for (const pjsonPath of packageJsonFiles) {
        const dir = join(rootDir, parse(pjsonPath).dir);
        const targetTs = join(dir, "tsconfig.json");
        const targetTypecheck = join(dir, "tsconfig.typecheck.json");

        // Skip the root config directory itself
        if (dir === join(rootDir, "packages/config")) {
            continue;
        }

        // Check for local config overrides
        const localWebTs = join(dir, "web.tsconfig.json");
        const localNodeTs = join(dir, "node.tsconfig.json");
        const localBuilderTs = join(dir, "builder.tsconfig.json");

        // Track if we generated a config for this package
        let generatedConfig = false;

        // Try to find nearest config template
        for (const relativeConfigPath of POSSIBLE_APP_CONFIG_LOCATIONS) {
            const nearestWebTs = join(dir, relativeConfigPath, "web.tsconfig.json");
            const nearestNodeTs = join(dir, relativeConfigPath, "node.tsconfig.json");
            const nearestBuilderTs = join(dir, relativeConfigPath, "builder.tsconfig.json");

            // Node config
            if (
                existsSync(localNodeTs) &&
                existsSync(nearestNodeTs) &&
                (!types || types.includes("node"))
            ) {
                try {
                    const extractedConfig = extractConfigFromExtends(nearestNodeTs);
                    const localConfig = JSON.parse(readFileSync(localNodeTs, "utf-8"));
                    const ts = merge({}, extractedConfig, localConfig);

                    delete ts.extends;

                    if (verbose) {
                        process.stdout.write(`writing Node 🧪 ${targetTs} 📝 (base: ${nearestNodeTs})\n`);
                    }

                    if (!dryRun) {
                        writeFileSync(targetTs, JSON.stringify(ts, null, 4), "utf-8");
                    }

                    result.generated.push({
                        type: "node",
                        path: targetTs,
                        basePath: nearestNodeTs,
                    });

                    generatedConfig = true;
                    break;
                } catch (error) {
                    result.errors.push({
                        path: targetTs,
                        error: String(error),
                    });
                    result.success = false;
                }
            }

            // Web config
            if (
                existsSync(localWebTs) &&
                existsSync(nearestWebTs) &&
                (!types || types.includes("web"))
            ) {
                try {
                    const extractedConfig = extractConfigFromExtends(nearestWebTs);
                    const localConfig = JSON.parse(readFileSync(localWebTs, "utf-8"));
                    const ts = merge({}, extractedConfig, localConfig);

                    delete ts.extends;

                    if (verbose) {
                        process.stdout.write(`writing Web 🕸️ ${targetTs} 📝 (base: ${nearestWebTs})\n`);
                    }

                    if (!dryRun) {
                        writeFileSync(targetTs, JSON.stringify(ts, null, 4), "utf-8");
                    }

                    result.generated.push({
                        type: "web",
                        path: targetTs,
                        basePath: nearestWebTs,
                    });

                    generatedConfig = true;
                    break;
                } catch (error) {
                    result.errors.push({
                        path: targetTs,
                        error: String(error),
                    });
                    result.success = false;
                }
            }

            // Builder config
            if (
                existsSync(localBuilderTs) &&
                existsSync(nearestBuilderTs) &&
                (!types || types.includes("builder"))
            ) {
                try {
                    const ts = merge(
                        {},
                        getTsconfig(targetTs)?.config,
                        templates.builderTs,
                    );

                    delete ts.references;
                    delete ts.watchOptions;
                    delete ts.extends;

                    if (verbose) {
                        process.stdout.write(`writing Builder 🏗️ ${targetTs} 📝 (base: ${nearestBuilderTs})\n`);
                    }

                    if (!dryRun) {
                        writeFileSync(localBuilderTs, JSON.stringify(ts, null, 4), "utf-8");
                    }

                    result.generated.push({
                        type: "builder",
                        path: localBuilderTs,
                        basePath: nearestBuilderTs,
                    });

                    generatedConfig = true;
                    break;
                } catch (error) {
                    if (verbose) {
                        process.stdout.write(`writing Builder 🏗ERROR ${targetTs} ${localBuilderTs} ${nearestBuilderTs} ${error}\n`);
                    }
                    result.errors.push({
                        path: localBuilderTs,
                        error: String(error),
                    });
                    result.success = false;
                }
            }
        }

        // Write typecheck config once per package (only if we generated a main config)
        if (generatedConfig) {
            if (verbose) {
                process.stdout.write(`writing TypeCheck 🔍 ${targetTypecheck} 📝\n`);
            }

            if (!dryRun) {
                writeFileSync(
                    targetTypecheck,
                    JSON.stringify(
                        {
                            extends: "./tsconfig.json",
                            compilerOptions: {
                                noEmit: true,
                                composite: false,
                                declaration: false,
                                declarationDir: null,
                                emitDeclarationOnly: false,
                                skipLibCheck: true,
                            },
                        },
                        null,
                        4,
                    ),
                    "utf-8",
                );
            }
        }
    }

    return result;
}
