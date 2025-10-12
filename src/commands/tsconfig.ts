import process from "node:process";
import { Command, Option } from "commander";
import { tsconfigHandler } from "../domains/tsconfig/index.js";
import { logger } from "../utils/logger.js";

/**
 * Format issue output for display
 */
function formatIssues(result: { success: boolean; issues: Array<{ severity: string; type: string; file?: string; package?: string; message: string; fix?: string }>; stats: { total: number; critical: number; high: number; medium: number; low: number } }): void {
    if (result.issues.length === 0) {
        return;
    }

    logger.info("\nIssues found:");

    const grouped = result.issues.reduce((acc, issue) => {
        if (!acc[issue.severity]) {
            acc[issue.severity] = [];
        }
        acc[issue.severity]!.push(issue);
        return acc;
    }, {} as Record<string, typeof result.issues>);

    for (const [severity, issues] of Object.entries(grouped)) {
        logger.info(`\n${severity.toUpperCase()}:`);
        for (const issue of issues) {
            const location = issue.file || issue.package || "unknown";
            logger.info(`  [${issue.type}] ${location}: ${issue.message}`);
            if (issue.fix) {
                logger.info(`    Fix: ${issue.fix}`);
            }
        }
    }

    logger.info(`\nSummary: ${result.stats.total} issue(s) - Critical: ${result.stats.critical}, High: ${result.stats.high}, Medium: ${result.stats.medium}, Low: ${result.stats.low}`);
}

export function createTsconfigCommand(): Command {
    const tsconfig = new Command("tsconfig")
        .description("Manage TypeScript configuration files")
        .addHelpText(
            "after",
            `
Examples:
  $ mono tsconfig generate              # Generate all TypeScript configs
  $ mono tsconfig generate --type=node  # Generate only node configs
  $ mono tsconfig generate --dry-run    # Preview changes without writing
  $ mono tsconfig check                 # Check for missing/broken configs
  $ mono tsconfig validate              # Validate all configs
  $ mono tsconfig validate --strict     # Strict validation mode

About:
  This command manages TypeScript configuration files across your monorepo.
  It can generate tsconfig.json files by merging base configs (web.tsconfig.json,
  node.tsconfig.json, or builder.tsconfig.json) with project-specific settings.

  The generator:
  - Finds base configs in config directories
  - Merges extends chains into flat configs
  - Filters compilerOptions.paths by package.json dependencies
  - Generates tsconfig.typecheck.json for type-only checking
`,
        );

    // tsconfig generate
    tsconfig
        .command("generate")
        .description("Generate TypeScript configuration files for all packages")
        .addOption(
            new Option("-t, --type <type>", "Config type to generate")
                .choices(["web", "node", "builder"]),
        )
        .option("--force", "Overwrite existing configs even if up to date", false)
        .option("--dry-run", "Preview changes without writing files", false)
        .action(async options => {
            try {
                const globalOpts = tsconfig.optsWithGlobals();
                const result = await tsconfigHandler.generate({
                    ...options,
                    cwd: globalOpts.cwd,
                    verbose: globalOpts.verbose,
                    silent: globalOpts.silent,
                });

                if (globalOpts.json) {
                    logger.json(result);
                } else {
                    if (result.success) {
                        logger.success(
                            `Generated ${result.generated} TypeScript configuration${result.generated === 1 ? "" : "s"}`,
                        );

                        if (globalOpts.verbose && result.files.length > 0) {
                            logger.info("\nGenerated files:");
                            result.files.forEach(file => logger.info(`  ✓ ${file}`));
                        }
                    } else {
                        logger.error(
                            `Generated ${result.generated} config(s) with ${result.errors} error${result.errors === 1 ? "" : "s"}`,
                        );
                    }
                }

                process.exit(result.success ? 0 : 1);
            } catch (error) {
                logger.error(`TypeScript configuration generation failed: ${String(error)}`);
                if (tsconfig.optsWithGlobals().verbose) {
                    logger.error(error instanceof Error ? error.stack || "" : "");
                }
                process.exit(1);
            }
        });

    // tsconfig check
    tsconfig
        .command("check")
        .description("Check TypeScript configuration health across the monorepo")
        .option("--fix", "Automatically fix issues by regenerating configs", false)
        .option("--strict", "Use strict checking rules", false)
        .action(async options => {
            try {
                const globalOpts = tsconfig.optsWithGlobals();
                const result = await tsconfigHandler.check({
                    ...options,
                    cwd: globalOpts.cwd,
                    verbose: globalOpts.verbose,
                    silent: globalOpts.silent,
                });

                if (globalOpts.json) {
                    logger.json(result);
                } else {
                    if (result.success) {
                        logger.success("All TypeScript configurations are healthy");
                    } else {
                        logger.warn(`Found ${result.stats.total} issue(s)`);
                        formatIssues(result);

                        if (options.fix) {
                            logger.info("\nAttempting to fix issues...");
                            const fixResult = await tsconfigHandler.generate({
                                cwd: globalOpts.cwd,
                                force: true,
                                verbose: globalOpts.verbose,
                            });

                            if (fixResult.success) {
                                logger.success("Successfully regenerated configurations");
                            } else {
                                logger.error(`Fixed some issues, but ${fixResult.errors} error(s) remain`);
                            }
                        }
                    }
                }

                process.exit(result.success ? 0 : 1);
            } catch (error) {
                logger.error(`TypeScript configuration check failed: ${String(error)}`);
                if (tsconfig.optsWithGlobals().verbose) {
                    logger.error(error instanceof Error ? error.stack || "" : "");
                }
                process.exit(1);
            }
        });

    // tsconfig validate
    tsconfig
        .command("validate")
        .description("Validate TypeScript configurations for correctness")
        .argument("[files...]", "Specific tsconfig files to validate (relative to monorepo root)")
        .option("--strict", "Enable strict validation rules", false)
        .action(async (files, options) => {
            try {
                const globalOpts = tsconfig.optsWithGlobals();
                const result = await tsconfigHandler.validate({
                    ...options,
                    files,
                    cwd: globalOpts.cwd,
                    verbose: globalOpts.verbose,
                    silent: globalOpts.silent,
                });

                if (globalOpts.json) {
                    logger.json(result);
                } else {
                    if (result.success) {
                        logger.success("All TypeScript configurations are valid");
                    } else {
                        logger.warn(`Found ${result.stats.total} validation issue(s)`);
                        formatIssues(result);
                    }
                }

                process.exit(result.success ? 0 : 1);
            } catch (error) {
                logger.error(`TypeScript configuration validation failed: ${String(error)}`);
                if (tsconfig.optsWithGlobals().verbose) {
                    logger.error(error instanceof Error ? error.stack || "" : "");
                }
                process.exit(1);
            }
        });

    return tsconfig;
}
