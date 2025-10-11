import { Command } from "commander";
import { qualityHandler } from "../domains/security/quality/index.js";
import { logger } from "../utils/logger.js";

export function createQualityCommand(): Command {
    const quality = new Command("quality")
        .alias("lint")
        .description("Code quality and linting");

    quality
        .command("check")
        .description("Run quality checks")
        .option("--lint", "run ESLint")
        .option("--types", "run TypeScript checks")
        .option("--format", "check code formatting")
        .option("--all", "run all checks", true)
        .option("--filter <packages...>", "filter packages")
        .action(async options => {
            try {
                const result = await qualityHandler.check(options);

                if (options.json) {
                    logger.json(result);
                } else {
                    if (result.success) {
                        logger.success("All quality checks passed!");
                    } else {
                        logger.error(`Quality checks failed: ${result.issues.length} issues found`);
                    }
                }

                process.exit(result.success ? 0 : 1);
            } catch (error) {
                logger.error(`Quality check failed: ${error}`);
                process.exit(1);
            }
        });

    quality
        .command("fix")
        .description("Auto-fix quality issues")
        .option("--lint", "fix lint issues")
        .option("--format", "fix formatting")
        .action(async options => {
            try {
                const result = await qualityHandler.fix(options);

                if (result.success) {
                    logger.success(`Fixed ${result.applied} quality issues`);
                }

                process.exit(result.success ? 0 : 1);
            } catch (error) {
                logger.error(`Quality fix failed: ${error}`);
                process.exit(1);
            }
        });

    return quality;
}
