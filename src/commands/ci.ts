import process from "node:process";
import { Command } from "commander";
import { $ } from "zx";
import { logger } from "../utils/logger.js";
import { findWorkspaceRoot } from "../utils/workspace.js";

export function createCiCommand(): Command {
    const ci = new Command("ci")
        .description("CI-related commands");

    ci
        .command("mirror")
        .description("Run typecheck + lint locally (mirrors CI)")
        .action(async () => {
            try {
                const root = await findWorkspaceRoot();

                $.env = { ...process.env, FORCE_COLOR: "1" };

                logger.info("Running typecheck...");
                await $({ cwd: root })`pnpm types`;

                logger.info("Running lint:fix...");
                await $({ cwd: root })`pnpm lint:fix`;

                logger.success("CI mirror complete");
            } catch (error) {
                logger.error(`CI mirror failed: ${error}`);
                process.exit(1);
            }
        });

    return ci;
}
