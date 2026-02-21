import type { TsconfigGenerateOptions, TsconfigType } from "../../runners/tsconfig";
import type { CheckResult, CommandOptions, Issue } from "../../types/index";
import { existsSync, readFileSync } from "node:fs";
import { join, parse } from "node:path";
import glob from "fast-glob";
import { ConfigManager } from "../../config/loader";
import {
    generateTsconfigs,

} from "../../runners/tsconfig";
import * as logger from "../../utils/logger";
import { getWorkspaceInfo } from "../../utils/workspace";

interface TsconfigGenerateCommandOptions extends CommandOptions {
    force?: boolean;
    type?: TsconfigType;
}

interface TsconfigGenerateResult {
    success: boolean;
    generated: number;
    errors: number;
    files: string[];
}

interface TsconfigCheckOptions extends CommandOptions {
    fix?: boolean;
    strict?: boolean;
}

interface TsconfigValidateOptions extends CommandOptions {
    files?: string[];
    strict?: boolean;
}

/**
 * Generate TypeScript configuration files across the monorepo
 */
const generate = async (
    options: TsconfigGenerateCommandOptions,
): Promise<TsconfigGenerateResult> => {
    try {
        const workspace = await getWorkspaceInfo(options.cwd);

        // Read schema config from ConfigManager (may not be initialized)
        let schemaConfig;
        try {
            const configManager = ConfigManager.getInstance();
            schemaConfig = configManager.getConfig()?.tsconfig;
        } catch {
            // Config not initialized — proceed without schema overrides
        }

        const generateOptions: TsconfigGenerateOptions = {
            rootDir: workspace.root,
            ...(options.type ? { types: [options.type] } : {}),
            ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
            ...(options.force !== undefined ? { force: options.force } : {}),
            ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
            ...(schemaConfig ? { schemaConfig } : {}),
        };

        const result = await generateTsconfigs(generateOptions);

        return {
            success: result.success,
            generated: result.generated.length,
            errors: result.errors.length,
            files: result.generated.map(g => g.path),
        };
    } catch (error) {
        logger.error("TypeScript configuration generation failed");
        throw error;
    }
};

/**
 * Validate extends chain for a tsconfig file
 */
function validateExtendsChain(
    configPath: string,
    visited = new Set<string>(),
): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!existsSync(configPath)) {
        return { valid: false, errors: [`Config file not found: ${configPath}`] };
    }

    if (visited.has(configPath)) {
        return { valid: false, errors: [`Circular extends detected: ${configPath}`] };
    }

    visited.add(configPath);

    try {
        const content = readFileSync(configPath, "utf-8");
        const config = JSON.parse(content) as { extends?: string; [key: string]: unknown };

        if (config.extends) {
            const extendedPath = join(parse(configPath).dir, config.extends);
            const result = validateExtendsChain(extendedPath, visited);
            errors.push(...result.errors);
        }
    } catch (error) {
        errors.push(`Failed to parse ${configPath}: ${String(error)}`);
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate TypeScript configurations across the monorepo
 */
const validate = async (options: TsconfigValidateOptions): Promise<CheckResult> => {
    const spinner = logger.spinner("Validating TypeScript configurations...");
    spinner.start();

    const issues: Issue[] = [];

    try {
        const workspace = await getWorkspaceInfo(options.cwd);
        const configManager = ConfigManager.getInstance();
        const config = configManager.getConfig();
        const tsconfigConfig = config?.tsconfig;

        const checkExtends = tsconfigConfig?.validation?.checkExtends ?? true;
        const strictMode = options.strict ?? tsconfigConfig?.validation?.strictMode ?? false;

        // Find all tsconfig.json files
        const tsconfigFiles = options.files?.length
            ? options.files
            : await glob("**/tsconfig.json", {
                    cwd: workspace.root,
                    absolute: false,
                    onlyFiles: true,
                    ignore: tsconfigConfig?.excludePatterns ?? [
                        "**/node_modules/**",
                        "**/dist/**",
                        "**/build/**",
                    ],
                });

        logger.debug(`Found ${tsconfigFiles.length} tsconfig files to validate`);

        // Validate each file
        for (const file of tsconfigFiles) {
            const fullPath = join(workspace.root, file);

            // Check if file exists
            if (!existsSync(fullPath)) {
                issues.push({
                    severity: "high",
                    type: "missing-file",
                    file,
                    message: `TypeScript config file not found`,
                });
                continue;
            }

            // Validate JSON syntax
            try {
                const content = readFileSync(fullPath, "utf-8");
                const config = JSON.parse(content);

                // Validate extends chain
                if (checkExtends && config.extends) {
                    const result = validateExtendsChain(fullPath);
                    if (!result.valid) {
                        issues.push({
                            severity: "high",
                            type: "invalid-extends",
                            file,
                            message: `Invalid extends chain: ${result.errors.join(", ")}`,
                        });
                    }
                }

                // Strict mode checks
                if (strictMode) {
                    const compilerOptions = config.compilerOptions as Record<string, unknown> | undefined;

                    if (!compilerOptions) {
                        issues.push({
                            severity: "medium",
                            type: "missing-compiler-options",
                            file,
                            message: "Missing compilerOptions",
                        });
                    }

                    // Check for common issues
                    if (compilerOptions?.strict !== true) {
                        issues.push({
                            severity: "medium",
                            type: "non-strict-mode",
                            file,
                            message: "Strict mode is not enabled",
                        });
                    }
                }
            } catch (error) {
                issues.push({
                    severity: "high",
                    type: "invalid-json",
                    file,
                    message: `Invalid JSON: ${String(error)}`,
                });
            }
        }

        spinner.succeed(`Validated ${tsconfigFiles.length} TypeScript configurations`);

        return {
            success: issues.length === 0,
            issues,
            stats: {
                total: issues.length,
                critical: issues.filter(i => i.severity === "critical").length,
                high: issues.filter(i => i.severity === "high").length,
                medium: issues.filter(i => i.severity === "medium").length,
                low: issues.filter(i => i.severity === "low").length,
            },
        };
    } catch (error) {
        spinner.fail("TypeScript configuration validation failed");
        throw error;
    }
};

/**
 * Check TypeScript configuration health
 */
const check = async (options: TsconfigCheckOptions): Promise<CheckResult> => {
    const spinner = logger.spinner("Checking TypeScript configurations...");
    spinner.start();

    const issues: Issue[] = [];

    try {
        const workspace = await getWorkspaceInfo(options.cwd);
        const configManager = ConfigManager.getInstance();
        const config = configManager.getConfig();
        const tsconfigConfig = config?.tsconfig;

        const checkMissing = tsconfigConfig?.validation?.checkMissing ?? true;
        const generateTypecheck = tsconfigConfig?.generateTypecheck ?? true;

        // Find all packages
        const packageJsonFiles = await glob("**/package.json", {
            cwd: workspace.root,
            absolute: false,
            onlyFiles: true,
            ignore: tsconfigConfig?.excludePatterns ?? [
                "**/node_modules/**",
                "**/dist/**",
                "**/build/**",
            ],
        });

        logger.debug(`Checking ${packageJsonFiles.length} packages for TypeScript configurations`);

        // Check each package
        for (const pkgPath of packageJsonFiles) {
            const dir = parse(pkgPath).dir;
            const fullDir = join(workspace.root, dir);

            // Skip root config directory (deprecated field, kept for compat)
            const rootConfigDir = tsconfigConfig?.rootConfigDir ?? "packages/config";
            if (rootConfigDir && dir === rootConfigDir) {
                continue;
            }

            // Check for main tsconfig.json
            const tsconfigPath = join(fullDir, "tsconfig.json");
            const hasMainConfig = existsSync(tsconfigPath);

            // Check for base configs (web.tsconfig.json, node.tsconfig.json, builder.tsconfig.json)
            const hasWebConfig = existsSync(join(fullDir, "web.tsconfig.json"));
            const hasNodeConfig = existsSync(join(fullDir, "node.tsconfig.json"));
            const hasBuilderConfig = existsSync(join(fullDir, "builder.tsconfig.json"));
            const hasAnyBaseConfig = hasWebConfig || hasNodeConfig || hasBuilderConfig;

            if (checkMissing && !hasMainConfig && hasAnyBaseConfig) {
                issues.push({
                    severity: "medium",
                    type: "missing-tsconfig",
                    package: dir,
                    file: `${dir}/tsconfig.json`,
                    message: "Package has base config but missing generated tsconfig.json",
                    fix: "Run: mono tsconfig generate",
                });
            }

            // Check for typecheck config
            if (generateTypecheck && hasMainConfig) {
                const typecheckPath = join(fullDir, "tsconfig.typecheck.json");
                if (!existsSync(typecheckPath)) {
                    issues.push({
                        severity: "low",
                        type: "missing-typecheck-config",
                        package: dir,
                        file: `${dir}/tsconfig.typecheck.json`,
                        message: "Missing typecheck configuration",
                        fix: "Run: mono tsconfig generate",
                    });
                }
            }

            // Validate extends chain if main config exists
            if (hasMainConfig) {
                const result = validateExtendsChain(tsconfigPath);
                if (!result.valid) {
                    issues.push({
                        severity: "high",
                        type: "broken-extends",
                        package: dir,
                        file: `${dir}/tsconfig.json`,
                        message: `Broken extends chain: ${result.errors.join(", ")}`,
                    });
                }
            }
        }

        spinner.succeed(`Checked ${packageJsonFiles.length} packages`);

        return {
            success: issues.length === 0,
            issues,
            stats: {
                total: issues.length,
                critical: issues.filter(i => i.severity === "critical").length,
                high: issues.filter(i => i.severity === "high").length,
                medium: issues.filter(i => i.severity === "medium").length,
                low: issues.filter(i => i.severity === "low").length,
            },
        };
    } catch (error) {
        spinner.fail("TypeScript configuration check failed");
        throw error;
    }
};

// Export handler object for consistency with other domains
export const tsconfigHandler = {
    generate,
    validate,
    check,
};
