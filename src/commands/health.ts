import process from "node:process";
import { Command, Option } from "commander";
import { healthHandler } from "../domains/health/index.js";
import { logger } from "../utils/logger.js";

export function createHealthCommand(): Command {
    const health = new Command("health")
        .description("Run comprehensive health check");

    health
        .command("check")
        .description("Check monorepo health")
        .option("--quick", "skip slow checks")
        .option("--detailed", "include detailed analysis")
        .option("--json", "output as JSON")
        .action(async options => {
            try {
                const result = await healthHandler.check(options);

                if (options.json) {
                    logger.json(result);
                } else {
                    logger.info("Monorepo Health Report");
                    logger.info("======================\n");

                    // Overall score
                    const score = result.score || 0;
                    const emoji = score > 80 ? "✅" : score > 60 ? "⚠️" : "❌";
                    logger.info(`Overall Health Score: ${emoji} ${score}/100\n`);

                    // Category breakdown
                    if (result.categories) {
                        logger.info("Category Scores:");
                        Object.entries(result.categories).forEach(([category, data]) => {
                            const catScore = data.score || 0;
                            const catEmoji = catScore > 80 ? "✓" : catScore > 60 ? "⚠" : "✗";
                            logger.info(`  ${catEmoji} ${category}: ${catScore}/100`);
                        });
                    }

                    // Issues summary
                    if (result.issues && result.issues.length > 0) {
                        logger.warn(`\n${result.issues.length} issues found`);
                        const critical = result.issues.filter(i => i.severity === "critical");
                        const high = result.issues.filter(i => i.severity === "high");

                        if (critical.length > 0) {
                            logger.error(`  Critical: ${critical.length}`);
                        }
                        if (high.length > 0) {
                            logger.warn(`  High: ${high.length}`);
                        }
                    }
                }

                process.exit(result.success ? 0 : 1);
            } catch (error) {
                logger.error(`Health check failed: ${error}`);
                process.exit(1);
            }
        });

    health
        .command("report")
        .description("Generate health dashboard")
        .option("--format <type>", "output format", "terminal")
        .option("--output <file>", "save to file")
        .action(async options => {
            try {
                await healthHandler.report(options);
                if (options.output) {
                    logger.success(`Health report saved to: ${options.output}`);
                }
            } catch (error) {
                logger.error(`Failed to generate report: ${error}`);
                process.exit(1);
            }
        });

    health
        .command("fix")
        .description("Auto-fix all fixable issues")
        .option("--dry-run", "preview changes")
        .addOption(
            new Option("--priority <level>", "fix priority level")
                .choices(["critical", "high", "all"])
                .default("high"),
        )
        .action(async options => {
            try {
                const result = await healthHandler.fix(options);

                if (options.dryRun) {
                    logger.info("Dry run - no changes applied");
                }

                logger.success(`Applied ${result.applied} fixes across all categories`);
                if (result.failed > 0) {
                    logger.warn(`Failed to apply ${result.failed} fixes`);
                }

                process.exit(result.success ? 0 : 1);
            } catch (error) {
                logger.error(`Health fix failed: ${error}`);
                process.exit(1);
            }
        });

    return health;
}
