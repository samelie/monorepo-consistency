import { Command } from "commander";
import { packageJsonHandler } from "../domains/packagejson/index.js";
import { logger } from "../utils/logger.js";

export function createPackageJsonCommand(): Command {
    const cmd = new Command("package-json")
        .alias("pkg")
        .description("Package.json hygiene and consistency checks");

    cmd
        .command("check")
        .description("Check package.json hygiene across workspace")
        .option("--scripts", "check script consistency")
        .option("--fields", "check required/forbidden fields")
        .option("--consistency", "check cross-package consistency")
        .option("--all", "run all checks", true)
        .action(async options => {
            try {
                const result = await packageJsonHandler.check(options);

                if (options.json) {
                    logger.json(result);
                } else {
                    // Display issues by severity
                    if (result.issues.length > 0) {
                        logger.info(`\nFound ${result.issues.length} issue(s):\n`);

                        const issuesBySeverity = {
                            critical: result.issues.filter(i => i.severity === "critical"),
                            high: result.issues.filter(i => i.severity === "high"),
                            medium: result.issues.filter(i => i.severity === "medium"),
                            low: result.issues.filter(i => i.severity === "low"),
                        };

                        for (const [severity, issues] of Object.entries(issuesBySeverity)) {
                            if (issues.length === 0) continue;

                            logger.info(`${severity.toUpperCase()}:`);
                            for (const issue of issues) {
                                const location = issue.package ? `[${issue.package}]` : "";
                                logger.info(`  ${location} ${issue.message}`);
                                if (issue.fix) {
                                    logger.debug(`    Fix: ${issue.fix}`);
                                }
                            }
                            logger.info("");
                        }

                        logger.info(`Summary: ${result.stats.total} issue(s) - Critical: ${result.stats.critical}, High: ${result.stats.high}, Medium: ${result.stats.medium}, Low: ${result.stats.low}\n`);
                    }

                    if (!result.success) {
                        logger.error("Package.json hygiene checks failed");
                        process.exit(1);
                    }

                    logger.success("All package.json hygiene checks passed!");
                }
            } catch (error) {
                logger.error(`Check failed: ${String(error)}`);
                process.exit(1);
            }
        });

    cmd
        .command("fix")
        .description("Auto-fix package.json issues")
        .option("--add-scripts", "add missing required scripts")
        .option("--add-recommended-scripts", "add missing recommended scripts")
        .option("--remove-scripts", "remove forbidden scripts")
        .option("--add-fields", "add missing required fields with defaults")
        .option("--remove-fields", "remove forbidden fields")
        .option("--all", "apply all available fixes")
        .option("--dry-run", "preview changes without writing")
        .action(async options => {
            try {
                const result = await packageJsonHandler.fix(options);

                if (options.json) {
                    logger.json(result);
                } else {
                    if (result.changes.length > 0) {
                        logger.info(`\nApplied ${result.changes.length} fix(es):\n`);

                        for (const change of result.changes) {
                            const location = change.package ? `[${change.package}]` : "";
                            logger.info(`  ${location} ${change.description}`);
                        }

                        logger.info("");
                    }

                    if (options.dryRun) {
                        logger.info("Dry run - no changes written");
                    } else {
                        logger.success(`Successfully applied ${result.applied} fix(es)`);
                    }

                    if (result.failed > 0) {
                        logger.warn(`Failed to apply ${result.failed} fix(es)`);
                    }
                }
            } catch (error) {
                logger.error(`Fix failed: ${String(error)}`);
                process.exit(1);
            }
        });

    return cmd;
}
