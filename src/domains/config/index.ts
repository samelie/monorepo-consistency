import type { RequiredFileRule } from "../../config/schema";
import type { Change, CheckResult, CommandOptions, ConfigType, FixResult, Issue, PackageInfo, WorkspaceInfo } from "../../types/index";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { minimatch } from "minimatch";
import { ConfigManager } from "../../config/loader";
import { DEFAULT_REQUIRED_FILE_RULES } from "../../config/schema";
import * as logger from "../../utils/logger";
import { getWorkspaceInfo } from "../../utils/workspace";

interface ConfigCheckOptions extends CommandOptions {
    tsconfig?: boolean;
    eslint?: boolean;
    packageJson?: boolean;
    all?: boolean;
    severity?: "error" | "warn" | "info";
}

interface ConfigFixOptions extends CommandOptions {
    addMissing?: boolean;
    updateScripts?: boolean;
}

/**
 * Dependency names signalling a web (browser) package — used to pick
 * web.tsconfig.json vs node.tsconfig.json when creating a missing marker.
 */
const WEB_DEP_SIGNALS = [
    /^vue$/,
    /^react(?:-dom)?$/,
    /^svelte$/,
    /^solid-js$/,
    /^vite$/,
    /^@vitejs\//,
    /^vue-router$/,
    /^pinia$/,
    /^three$/,
];

/**
 * Resolve required-file rules from schema config (defaults when no config loaded)
 */
function resolveFilesConfig(): { enabled: boolean; rules: RequiredFileRule[] } {
    try {
        const config = ConfigManager.getInstance().getConfig();
        return {
            enabled: config?.files?.enabled ?? true,
            rules: config?.files?.rules ?? DEFAULT_REQUIRED_FILE_RULES,
        };
    } catch {
        return { enabled: true, rules: DEFAULT_REQUIRED_FILE_RULES };
    }
}

/**
 * A rule covering both web and node tsconfig markers — creating one hands
 * tsconfig.json ownership to the generator
 */
function isMarkerPairRule(rule: RequiredFileRule): boolean {
    return rule.anyOf.includes("web.tsconfig.json") && rule.anyOf.includes("node.tsconfig.json");
}

/**
 * Check a single required-file rule against a package
 */
function checkRule(pkg: PackageInfo, workspaceRoot: string, rule: RequiredFileRule): Issue | undefined {
    if (rule.ignorePackages.some(pattern => minimatch(pkg.name, pattern))) {
        return undefined;
    }

    const dir = relative(workspaceRoot, pkg.path);
    const existing = rule.anyOf.find(file => existsSync(join(pkg.path, file)));

    if (!existing) {
        // Handwritten tsconfig.json without a marker: needs deliberate migration,
        // since generating from a fresh marker would overwrite it
        if (isMarkerPairRule(rule) && existsSync(join(pkg.path, "tsconfig.json"))) {
            return {
                severity: rule.severity,
                type: `unmanaged-${rule.name}`,
                package: pkg.name,
                file: join(dir, "tsconfig.json"),
                message: "Package has handwritten tsconfig.json without a marker file",
                fix: "Migrate: create a web/node.tsconfig.json marker with any package-specific overrides, then run mono tsconfig generate",
            };
        }

        return {
            severity: rule.severity,
            type: `missing-${rule.name}`,
            package: pkg.name,
            file: dir,
            message: `Missing required file (one of: ${rule.anyOf.join(", ")})`,
            fix: "Run: mono config fix --add-missing",
        };
    }

    if (rule.mustContain) {
        const content = readFileSync(join(pkg.path, existing), "utf-8");
        if (!content.includes(rule.mustContain)) {
            return {
                severity: rule.severity,
                type: `invalid-${rule.name}`,
                package: pkg.name,
                file: join(dir, existing),
                message: `${existing} must contain "${rule.mustContain}"`,
            };
        }
    }

    return undefined;
}

/**
 * Filter rules by CLI flags (--eslint / --tsconfig / --all)
 */
function selectRules(rules: RequiredFileRule[], options: ConfigCheckOptions): RequiredFileRule[] {
    if (options.all || (!options.eslint && !options.tsconfig)) {
        return rules;
    }
    return rules.filter(rule =>
        (options.eslint && rule.name.includes("eslint"))
        || (options.tsconfig && rule.name.includes("tsconfig")),
    );
}

/**
 * Run all required-file rules across workspace packages
 */
function checkRequiredFiles(workspace: WorkspaceInfo, options: ConfigCheckOptions): Issue[] {
    const { enabled, rules } = resolveFilesConfig();
    if (!enabled) {
        return [];
    }

    const issues: Issue[] = [];
    for (const pkg of workspace.packages) {
        for (const rule of selectRules(rules, options)) {
            const issue = checkRule(pkg, workspace.root, rule);
            if (issue) {
                issues.push(issue);
            }
        }
    }
    return issues;
}

/**
 * Pick the filename to create for a package missing all of a rule's alternatives.
 * web/node marker pairs without an explicit createAs use a dependency heuristic.
 */
function pickCreateTarget(rule: RequiredFileRule, pkg: PackageInfo): string | undefined {
    if (rule.createAs) {
        return rule.createAs;
    }

    if (rule.anyOf.includes("web.tsconfig.json") && rule.anyOf.includes("node.tsconfig.json")) {
        const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
        const isWeb = deps.some(dep => WEB_DEP_SIGNALS.some(signal => signal.test(dep)));
        return isWeb ? "web.tsconfig.json" : "node.tsconfig.json";
    }

    return rule.anyOf[0];
}

const checkPackageJsonFiles = async (_workspacePath: string): Promise<Issue[]> => {
    logger.debug("Checking package.json files...");
    // TODO: Run package-json-enforcer logic
    // - Required scripts
    // - Dependency placement
    // - Workspace protocol usage
    return [];
};

const check = async (options: ConfigCheckOptions): Promise<CheckResult> => {
    const spinner = logger.spinner("Checking configurations...");
    spinner.start();

    try {
        const workspace = await getWorkspaceInfo(options.cwd);
        const issues: Issue[] = checkRequiredFiles(workspace, options);

        if (options.packageJson || options.all) {
            issues.push(...await checkPackageJsonFiles(workspace.root));
        }

        spinner.succeed("Configuration check complete");

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
        spinner.fail("Configuration check failed");
        throw error;
    }
};

const fix = async (options: ConfigFixOptions): Promise<FixResult> => {
    const spinner = logger.spinner("Fixing configuration issues...");
    spinner.start();

    try {
        const changes: Change[] = [];
        let failed = 0;

        if (options.addMissing) {
            logger.debug("Adding missing configurations...");
            const workspace = await getWorkspaceInfo(options.cwd);
            const { enabled, rules } = resolveFilesConfig();

            if (enabled) {
                for (const pkg of workspace.packages) {
                    for (const rule of rules) {
                        if (rule.ignorePackages.some(pattern => minimatch(pkg.name, pattern))) {
                            continue;
                        }
                        if (rule.anyOf.some(file => existsSync(join(pkg.path, file)))) {
                            continue;
                        }
                        // Never auto-create a marker over a handwritten tsconfig.json —
                        // the next `mono tsconfig generate` would overwrite it
                        if (isMarkerPairRule(rule) && existsSync(join(pkg.path, "tsconfig.json"))) {
                            logger.debug(`Skipping ${rule.name} for ${pkg.name}: handwritten tsconfig.json present`);
                            continue;
                        }

                        const target = pickCreateTarget(rule, pkg);
                        if (!target) {
                            continue;
                        }

                        const filePath = join(pkg.path, target);
                        try {
                            if (!options.dryRun) {
                                writeFileSync(filePath, rule.defaultContent, "utf-8");
                            }
                            changes.push({
                                type: `create-${rule.name}`,
                                package: pkg.name,
                                file: relative(workspace.root, filePath),
                                description: `Created ${target} for ${pkg.name}`,
                            });
                        } catch (error) {
                            failed++;
                            logger.debug(`Failed to create ${filePath}: ${error}`);
                        }
                    }
                }
            }
        }

        if (options.updateScripts) {
            logger.debug("Updating package.json scripts...");
            // TODO: Update required scripts in package.json files
        }

        spinner.succeed("Configuration fixes complete");

        return {
            success: failed === 0,
            applied: changes.length,
            failed,
            changes,
        };
    } catch (error) {
        spinner.fail("Configuration fix failed");
        throw error;
    }
};

const validate = async (type: ConfigType, files: string[], _options: CommandOptions): Promise<void> => {
    const spinner = logger.spinner(`Validating ${type} configuration...`);
    spinner.start();

    try {
    // TODO: Implement targeted validation for specific config types
        logger.debug(`Validating ${type} in ${files.length || "all"} files`);

        spinner.succeed("Validation complete");
    } catch (error) {
        spinner.fail("Validation failed");
        throw error;
    }
};

const generate = async (_type: ConfigType | undefined, _options: CommandOptions & { force?: boolean; template?: string }): Promise<void> => {
    // TODO: Implement config generation
    throw new Error("Config generation not yet implemented");
};

// Export handler object for consistency with command structure
export const configHandler = {
    check,
    validate,
    fix,
    generate,
};
