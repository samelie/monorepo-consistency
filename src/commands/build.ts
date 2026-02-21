import process from "node:process";
import { Command } from "commander";
import { buildHandler } from "../domains/build/index";
import { logger } from "../utils/logger";

export function createBuildCommand(): Command {
    const build = new Command("build")
        .description("Build packages in configured order")
        .option("--dry-run", "preview build commands without executing")
        .option("--packages <packages...>", "override package list")
        .action(async (options: { dryRun?: boolean; packages?: string[] }) => {
            try {
                const result = await buildHandler.run({
                    packages: options.packages,
                    dryRun: options.dryRun,
                });

                if (result.built.length > 0) {
                    logger.success(`Built ${result.built.length} packages`);
                } else if (!options.dryRun) {
                    logger.info("No packages to build");
                }
            } catch (error) {
                logger.error(`Build failed: ${error}`);
                process.exit(1);
            }
        });

    return build;
}
