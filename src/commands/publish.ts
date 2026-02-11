import process from "node:process";
import { Command } from "commander";
import { publishHandler } from "../domains/publish/index.js";
import { logger } from "../utils/logger.js";

export function createPublishCommand(): Command {
    const publish = new Command("publish")
        .description("Publishing and public package management");

    publish
        .command("init <name> <source-path>")
        .description("Initialize a new public package repo and add to sync config")
        .option("--yes", "skip confirmation prompts")
        .option("--github-username <username>", "GitHub username (or set publish.githubUsername in config)")
        .action(async (name: string, sourcePath: string, options: { yes?: boolean; githubUsername?: string }) => {
            try {
                await publishHandler.initPublic({
                    packageName: name,
                    sourcePath,
                    yes: options.yes,
                    githubUsername: options.githubUsername,
                });
            } catch (error) {
                logger.error(`Failed to init public package: ${error}`);
                process.exit(1);
            }
        });

    return publish;
}
