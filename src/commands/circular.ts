import process from "node:process";
import { Command } from "commander";
import { circularHandler } from "../domains/circular/index";
import { logger } from "../utils/logger";

export function createCircularCommand(): Command {
    const circular = new Command("circular")
        .alias("circ")
        .description("Detect circular dependencies in workspace");

    circular
        .command("check")
        .description("Check for circular dependency issues")
        .option("--intra", "only check intra-package (module-level) cycles")
        .option("--inter", "only check inter-package (workspace-level) cycles")
        .option("--all", "run all checks (default)")
        .option("--packages <patterns...>", "filter to specific packages (glob)")
        .option("--tool <tool>", "force a specific tool (dpdm or madge)")
        .option("--json", "output as JSON")
        .action(async options => {
            try {
                const result = await circularHandler.check(options);

                if (options.json) {
                    logger.json(result);
                } else {
                    if (result.issues.length === 0) {
                        logger.success("No circular dependencies found!");
                    } else {
                        logger.warn(`Found ${result.issues.length} circular dependency issues`);
                        result.issues.forEach(issue => {
                            const prefix = issue.severity === "critical" || issue.severity === "high"
                                ? "  ✗"
                                : "  ⚠";
                            logger.warn(`${prefix} [${issue.severity}] ${issue.message}`);
                            if (issue.fix) {
                                logger.info(`    Fix: ${issue.fix}`);
                            }
                        });
                    }
                }

                process.exit(result.success ? 0 : 1);
            } catch (error) {
                logger.error(`Failed to check circular dependencies: ${error}`);
                process.exit(1);
            }
        });

    return circular;
}
