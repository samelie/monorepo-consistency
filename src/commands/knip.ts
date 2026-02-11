import process from "node:process";
import { Command } from "commander";
import { knipHandler } from "../domains/knip/index.js";
import { logger } from "../utils/logger.js";

export function createKnipCommand(): Command {
    const knip = new Command("knip")
        .description("Manage Knip dead-code configurations");

    // knip generate
    knip
        .command("generate")
        .description("Generate knip.config.ts for all workspace packages")
        .option("--force", "Overwrite existing knip configs", false)
        .option("--dry-run", "Preview changes without writing files", false)
        .action(async options => {
            try {
                const globalOpts = knip.optsWithGlobals();
                const result = await knipHandler.generate({
                    ...options,
                    cwd: globalOpts.cwd,
                    verbose: globalOpts.verbose,
                    silent: globalOpts.silent,
                });

                if (globalOpts.json) {
                    logger.json(result);
                } else if (result.success) {
                    logger.success(
                        `Generated ${result.generated} knip config(s), skipped ${result.skipped}`,
                    );
                }
            } catch (error) {
                logger.error(`Knip config generation failed: ${String(error)}`);
                process.exit(1);
            }
        });

    // knip check
    knip
        .command("check")
        .description("Check that all packages have knip configurations")
        .action(async () => {
            try {
                const globalOpts = knip.optsWithGlobals();
                const result = await knipHandler.check({
                    cwd: globalOpts.cwd,
                    verbose: globalOpts.verbose,
                    silent: globalOpts.silent,
                });

                if (globalOpts.json) {
                    logger.json(result);
                } else {
                    if (result.success) {
                        logger.success("All packages have knip configurations");
                    } else {
                        logger.warn(`Found ${result.stats.total} issue(s)`);
                        for (const issue of result.issues) {
                            const location = issue.package || issue.file || "unknown";
                            logger.warn(`  [${issue.type}] ${location}: ${issue.message}`);
                            if (issue.fix) {
                                logger.info(`    Fix: ${issue.fix}`);
                            }
                        }
                    }
                }

                process.exit(result.success ? 0 : 1);
            } catch (error) {
                logger.error(`Knip check failed: ${String(error)}`);
                process.exit(1);
            }
        });

    return knip;
}
