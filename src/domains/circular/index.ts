import type { CircularConfig } from "../../config/schema";
import type { CheckResult, CommandOptions, Issue, PackageInfo, SeverityLevel } from "../../types/index";
import { minimatch } from "minimatch";
import { ConfigManager } from "../../config/loader";
import { runDpdm } from "../../runners/dpdm";
import { runMadge } from "../../runners/madge";
import * as logger from "../../utils/logger";
import { getWorkspaceInfo } from "../../utils/workspace";
import { detectInterPackageCycles } from "./inter-package";

interface CircularCheckOptions extends CommandOptions {
    intra?: boolean;
    inter?: boolean;
    all?: boolean;
    packages?: string[];
    tool?: "dpdm" | "madge";
}

function getCircularConfig(): CircularConfig | undefined {
    try {
        const configManager = ConfigManager.getInstance();
        const config = configManager.getConfig();
        return config?.circular;
    } catch {
        return undefined;
    }
}

function filterPackages(
    packages: PackageInfo[],
    cliPackages: string[] | undefined,
    config: CircularConfig | undefined,
): PackageInfo[] {
    let filtered = packages;

    // CLI --packages filter takes precedence
    if (cliPackages?.length) {
        filtered = filtered.filter(p =>
            cliPackages.some(pattern => minimatch(p.name, pattern)),
        );
        return filtered;
    }

    // Config-level include/exclude
    const include = config?.includePackages ?? [];
    const exclude = config?.excludePackages ?? [];

    if (include.length > 0) {
        filtered = filtered.filter(p =>
            include.some(pattern => minimatch(p.name, pattern)),
        );
    }

    if (exclude.length > 0) {
        filtered = filtered.filter(p =>
            !exclude.some(pattern => minimatch(p.name, pattern)),
        );
    }

    return filtered;
}

function isIgnoredCycle(
    cycle: string[],
    packageName: string | undefined,
    config: CircularConfig | undefined,
): boolean {
    if (!config?.ignoreCycles?.length) return false;

    return cycle.some(file =>
        config.ignoreCycles.some(ignore => {
            if (ignore.package && packageName && !minimatch(packageName, ignore.package)) {
                return false;
            }
            return minimatch(file, ignore.pattern);
        }),
    );
}

function isIgnoredPackageCycle(
    cycle: string[],
    config: CircularConfig | undefined,
): boolean {
    if (!config?.ignorePackageCycles?.length) return false;

    return config.ignorePackageCycles.some(ignoredCycle => {
        // Check if the detected cycle contains all members of the ignored cycle
        const cycleSet = new Set(cycle);
        return ignoredCycle.every(pkg => cycleSet.has(pkg));
    });
}

/**
 * Normalize a cycle array for deduplication: rotate to smallest element first, then join.
 */
function normalizeCycle(cycle: string[]): string {
    if (cycle.length === 0) return "";
    const minIdx = cycle.indexOf(
        cycle.reduce((a, b) => (a < b ? a : b)),
    );
    const rotated = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
    return rotated.join(" -> ");
}

function deduplicateCycles(cycles: string[][]): string[][] {
    const seen = new Set<string>();
    const result: string[][] = [];
    for (const cycle of cycles) {
        const key = normalizeCycle(cycle);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(cycle);
        }
    }
    return result;
}

async function runIntraPackage(
    pkg: PackageInfo,
    tools: Array<"dpdm" | "madge">,
    config: CircularConfig | undefined,
): Promise<Issue[]> {
    const issues: Issue[] = [];
    const allCycles: string[][] = [];
    const severity: SeverityLevel = config?.intraPackageSeverity ?? "high";

    for (const tool of tools) {
        try {
            if (tool === "dpdm") {
                const result = await runDpdm(pkg.path, config?.dpdm);
                allCycles.push(...result.circular);
            } else {
                const result = await runMadge(pkg.path, config?.madge);
                allCycles.push(...result.circular);
            }
        } catch (error) {
            logger.warn(`${tool} failed for ${pkg.name}: ${error}`);
        }
    }

    const unique = deduplicateCycles(allCycles);

    for (const cycle of unique) {
        if (isIgnoredCycle(cycle, pkg.name, config)) continue;

        issues.push({
            severity,
            type: "circular-import",
            package: pkg.name,
            message: `Circular import chain: ${cycle.join(" -> ")}`,
            fix: "Refactor to break the cycle (extract shared code, use lazy imports, or restructure modules)",
        });
    }

    return issues;
}

const check = async (options: CircularCheckOptions): Promise<CheckResult> => {
    const spinner = logger.spinner("Checking for circular dependencies...");
    spinner.start();

    try {
        const config = getCircularConfig();

        if (config?.enabled === false) {
            spinner.succeed("Circular dependency checks disabled");
            return { success: true, issues: [], stats: { total: 0, critical: 0, high: 0, medium: 0, low: 0 } };
        }

        const workspace = await getWorkspaceInfo(options.cwd);
        const issues: Issue[] = [];

        const runIntra = options.intra || options.all || (!options.intra && !options.inter);
        const runInter = options.inter || options.all || (!options.intra && !options.inter);

        // Determine tools
        let tools: Array<"dpdm" | "madge"> = config?.tools ?? ["dpdm", "madge"];
        if (options.tool) {
            tools = [options.tool];
        }

        // Intra-package checks
        if (runIntra && (config?.intraPackage !== false)) {
            const targetPackages = filterPackages(workspace.packages, options.packages, config);
            logger.debug(`Scanning ${targetPackages.length} packages for intra-package cycles`);

            const intraResults = await Promise.all(
                targetPackages.map(pkg => runIntraPackage(pkg, tools, config)),
            );
            issues.push(...intraResults.flat());
        }

        // Inter-package checks
        if (runInter && (config?.interPackage !== false)) {
            logger.debug("Scanning workspace dependency graph for inter-package cycles");
            const severity: SeverityLevel = config?.interPackageSeverity ?? "critical";

            const cycles = detectInterPackageCycles(workspace.packages);
            for (const cycle of cycles) {
                if (isIgnoredPackageCycle(cycle, config)) continue;

                issues.push({
                    severity,
                    type: "circular-workspace-dep",
                    message: `Circular workspace dependency: ${cycle.join(" -> ")} -> ${cycle[0]}`,
                    fix: "Restructure packages to break the workspace dependency cycle",
                });
            }
        }

        spinner.succeed("Circular dependency check complete");

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
        spinner.fail("Circular dependency check failed");
        throw error;
    }
};

export const circularHandler = { check };
