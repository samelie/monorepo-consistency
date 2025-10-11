import { Command, Option } from "commander";
import { configHandler } from "../domains/config/index.js";
import { logger } from "../utils/logger.js";

export function createConfigCommand(): Command {
    const config = new Command("config")
        .description("Manage configuration consistency");

    // config check
    config
        .command("check")
        .description("Validate configuration files")
        .option("--tsconfig", "check TypeScript configs")
        .option("--eslint", "check ESLint configs")
        .option("--package-json", "check package.json files")
        .option("--all", "check all configs", true)
        .addOption(
            new Option("--severity <level>", "minimum severity to report")
                .choices(["error", "warn", "info"])
                .default("error"),
        )
        .action(async options => {
            try {
                const result = await configHandler.check(options);

                if (options.json) {
                    logger.json(result);
                } else {
                    if (result.issues.length === 0) {
                        logger.success("All configurations are valid!");
                    } else {
                        logger.warn(`Found ${result.issues.length} configuration issues`);
                        result.issues.forEach(issue => {
                            logger.warn(`  [${issue.severity}] ${issue.message}`);
                            if (issue.file) {
                                logger.info(`    File: ${issue.file}`);
                            }
                            if (issue.fix) {
                                logger.info(`    Fix: ${issue.fix}`);
                            }
                        });
                    }
                }

                process.exit(result.success ? 0 : 1);
            } catch (error) {
                logger.error(`Failed to check configurations: ${error}`);
                process.exit(1);
            }
        });

    // config fix
    config
        .command("fix")
        .description("Auto-fix configuration issues")
        .option("--add-missing", "add missing configs")
        .option("--update-scripts", "update required scripts")
        .option("--dry-run", "preview changes")
        .action(async options => {
            try {
                const result = await configHandler.fix(options);

                if (options.dryRun) {
                    logger.info("Dry run - no changes applied");
                }

                if (result.changes.length === 0) {
                    logger.info("No configuration fixes needed");
                } else {
                    logger.success(`Applied ${result.applied} configuration fixes`);
                    result.changes.forEach(change => {
                        logger.info(`  ${change.description}`);
                    });
                }

                process.exit(result.success ? 0 : 1);
            } catch (error) {
                logger.error(`Failed to fix configurations: ${error}`);
                process.exit(1);
            }
        });

    // config generate
    config
        .command("generate")
        .description("Generate configuration files")
        .argument("[type]", "config type (tsconfig, eslint, etc.)")
        .option("--force", "overwrite existing configs")
        .option("--template <name>", "use specific template")
        .action(async (type, options) => {
            try {
                await configHandler.generate(type, options);
                logger.success(`Generated ${type || "all"} configuration(s)`);
            } catch (error) {
                logger.error(`Failed to generate configuration: ${error}`);
                process.exit(1);
            }
        });

    // config validate
    config
        .command("validate")
        .description("Validate specific config type")
        .argument("<type>", "config type to validate")
        .argument("[files...]", "specific files to validate")
        .action(async (type, files, options) => {
            try {
                await configHandler.validate(type, files, options);
                logger.success("Configuration validation passed");
            } catch (error) {
                logger.error(`Configuration validation failed: ${error}`);
                process.exit(1);
            }
        });

    return config;
}
