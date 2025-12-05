import type { Change, CheckResult, CommandOptions, FixResult, Issue, ReportOptions } from "../../types/index.js";
import { ConfigManager } from "../../config/loader.js";
import { runTaze } from "../../runners/taze.js";
import * as logger from "../../utils/logger.js";
import { getWorkspaceInfo } from "../../utils/workspace.js";

interface DepsCheckOptions extends CommandOptions {
    unused?: boolean;
    mismatches?: boolean;
    outdated?: boolean;
    all?: boolean;
}

interface DepsFixOptions extends CommandOptions {
    removeUnused?: boolean;
    fixMismatches?: boolean;
}

interface DepsUpdateOptions extends CommandOptions {
    interactive?: boolean;
    major?: boolean;
    minor?: boolean;
    patch?: boolean;
    filter?: string[];
    exclude?: string[];
    write?: boolean;
    install?: boolean;
    recursive?: boolean;
    includeLocked?: boolean;
    all?: boolean;
    dryRun?: boolean;
}

interface DepsUpgradeOptions extends CommandOptions {
    /** The dependency name to upgrade (e.g., "typescript", "react") */
    dependency: string;
    /** Allow major version upgrades */
    major?: boolean;
    /** Only minor version upgrades */
    minor?: boolean;
    /** Only patch version upgrades */
    patch?: boolean;
    /** Write changes to package.json */
    write?: boolean;
    /** Run install after upgrading */
    install?: boolean;
    /** Preview without applying */
    dryRun?: boolean;
}

interface UpgradeResult {
    success: boolean;
    dependency: string;
    mode: "major" | "minor" | "patch";
    dryRun: boolean;
}

// Pure functions for dependency operations

const checkUnusedDependencies = async (_workspacePath: string): Promise<Issue[]> => {
    // TODO: Run knip and parse results
    logger.debug("Checking for unused dependencies with knip...");
    return [];
};

const checkVersionMismatches = async (_workspacePath: string): Promise<Issue[]> => {
    // TODO: Run syncpack list-mismatches and parse results
    logger.debug("Checking for version mismatches with syncpack...");
    return [];
};

const checkOutdatedPackages = async (_workspacePath: string): Promise<Issue[]> => {
    logger.debug("Checking for outdated packages with taze...");

    // For now, just return a placeholder
    // The actual check would run taze with --fail-on-outdated
    return [];
};

const check = async (options: DepsCheckOptions): Promise<CheckResult> => {
    const spinner = logger.spinner("Checking dependencies...");
    spinner.start();

    try {
        const workspace = await getWorkspaceInfo(options.cwd);
        const issuePromises: Promise<Issue[]>[] = [];

        if (options.unused || options.all) {
            issuePromises.push(checkUnusedDependencies(workspace.root));
        }

        if (options.mismatches || options.all) {
            issuePromises.push(checkVersionMismatches(workspace.root));
        }

        if (options.outdated || options.all) {
            issuePromises.push(checkOutdatedPackages(workspace.root));
        }

        const issueArrays = await Promise.all(issuePromises);
        const issues = issueArrays.flat();

        spinner.succeed("Dependency check complete");

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
        spinner.fail("Dependency check failed");
        throw error;
    }
};

const fix = async (options: DepsFixOptions): Promise<FixResult> => {
    const spinner = logger.spinner("Fixing dependency issues...");
    spinner.start();

    try {
        const changes: Change[] = [];

        if (options.dryRun) {
            logger.debug("Running in dry-run mode");
        }

        if (options.removeUnused) {
            logger.debug("Removing unused dependencies...");
            // TODO: Run knip --fix
        }

        if (options.fixMismatches) {
            logger.debug("Fixing version mismatches...");
            // TODO: Run syncpack fix-mismatches
        }

        spinner.succeed("Dependency fixes complete");

        return {
            success: true,
            applied: changes.length,
            failed: 0,
            changes,
        };
    } catch (error) {
        spinner.fail("Dependency fix failed");
        throw error;
    }
};

const update = async (options: DepsUpdateOptions): Promise<void> => {
    const spinner = logger.spinner("Updating dependencies...");
    spinner.start();

    try {
        logger.debug("Running dependency updates with taze...");

        // Get workspace info to find monorepo root
        const workspace = await getWorkspaceInfo(options.cwd);

        // Get configuration if available
        let tazeConfig;
        try {
            const configManager = ConfigManager.getInstance();
            const config = configManager.getConfig();
            tazeConfig = config?.deps?.taze;
        } catch {
            // No config loaded, use defaults
            tazeConfig = undefined;
        }

        // Build CLI arguments for taze
        const args: string[] = [];

        // Add mode
        if (options.major) args.push("major");
        else if (options.minor) args.push("minor");
        else if (options.patch) args.push("patch");

        // Add flags
        if (options.interactive) args.push("--interactive");
        if (options.write) args.push("--write");
        if (options.install) args.push("--install");
        if (options.recursive !== false) args.push("--recursive");
        if (options.includeLocked) args.push("--include-locked");
        if (options.all) args.push("--all");

        // Add filters
        if (options.filter?.length) {
            args.push("--include", options.filter.join(","));
        }
        if (options.exclude?.length) {
            args.push("--exclude", options.exclude.join(","));
        }

        // Dry run just logs the command
        if (options.dryRun) {
            const runner = tazeConfig?.runner || "npx";
            logger.info(`[DRY RUN] Would execute from ${workspace.root}: ${runner} taze ${args.join(" ")}`);
            spinner.succeed("Dependency update preview complete");
            return;
        }

        // Run taze from monorepo root
        await runTaze({
            ...(tazeConfig ? { config: tazeConfig } : {}),
            args,
            cwd: workspace.root,
            silent: false,
        });

        spinner.succeed("Dependency update complete");
    } catch (error) {
        spinner.fail("Dependency update failed");
        throw error;
    }
};

const report = async (options: ReportOptions): Promise<void> => {
    const spinner = logger.spinner("Generating dependency report...");
    spinner.start();

    try {
    // TODO: Generate comprehensive dependency report
        logger.debug("Collecting dependency information...");

        spinner.succeed("Report generated");

        if (options.output) {
            logger.info(`Report saved to: ${options.output}`);
        }
    } catch (error) {
        spinner.fail("Report generation failed");
        throw error;
    }
};

/**
 * Upgrade a single dependency across the entire monorepo
 *
 * Maps to: taze [major|minor|patch] -r --include <dependency> [-w] [--install]
 */
const upgrade = async (options: DepsUpgradeOptions): Promise<UpgradeResult> => {
    const { dependency, major, minor, patch, write, install, dryRun } = options;

    // Determine upgrade mode (default to major)
    const mode = patch ? "patch" : minor ? "minor" : "major";

    const spinner = logger.spinner(`Upgrading ${dependency} (${mode})...`);
    spinner.start();

    try {
        const workspace = await getWorkspaceInfo(options.cwd);

        // Get taze config if available
        let tazeConfig;
        try {
            const configManager = ConfigManager.getInstance();
            const config = configManager.getConfig();
            tazeConfig = config?.deps?.taze;
        } catch {
            tazeConfig = undefined;
        }

        // Build taze arguments: taze [mode] -r --include <dep> [-w] [--install]
        const args: string[] = [mode, "--recursive", "--include", dependency];

        if (write) {
            args.push("--write");
        }

        if (install) {
            args.push("--install");
        }

        const runner = tazeConfig?.runner || "npx";

        if (dryRun) {
            logger.info(`[DRY RUN] Would execute: ${runner} taze ${args.join(" ")}`);
            spinner.succeed(`Upgrade preview complete for ${dependency}`);
            return { success: true, dependency, mode, dryRun: true };
        }

        await runTaze({
            ...(tazeConfig ? { config: tazeConfig } : {}),
            args,
            cwd: workspace.root,
            silent: false,
        });

        spinner.succeed(`Upgraded ${dependency} (${mode})`);
        return { success: true, dependency, mode, dryRun: false };
    } catch (error) {
        spinner.fail(`Failed to upgrade ${dependency}`);
        throw error;
    }
};

// Export handler object for consistency with command structure
export const depsHandler = {
    check,
    fix,
    update,
    upgrade,
    report,
};
