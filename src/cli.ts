#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { createBuildCommand } from "./commands/build";
import { createCiCommand } from "./commands/ci";
import { createCircularCommand } from "./commands/circular";
import { createConfigCommand } from "./commands/config";
import { createDepsCommand } from "./commands/deps";
import { createEnvCommand } from "./commands/env";
import { createInitCommand } from "./commands/init";
import { createKnipCommand } from "./commands/knip";
import { createPackageJsonCommand } from "./commands/packagejson";
import { createPublishCommand } from "./commands/publish";
import { createSchemaCommand } from "./commands/schema";
import { createTsconfigCommand } from "./commands/tsconfig";
import { ConfigManager } from "./config/loader";
import { logger } from "./utils/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8")) as { version: string };

const program = new Command();

// Main program configuration
program
    .name("mono")
    .description("Monorepo consistency and maintenance toolkit")
    .version(pkg.version)
    .configureHelp({
        sortSubcommands: true,
        subcommandTerm: cmd => cmd.name(),
    });

// Global options
program
    .option("--cwd <path>", "working directory", process.cwd())
    .option("-c, --config <path>", "configuration file path")
    .option("--verbose", "verbose output")
    .option("--silent", "suppress output")
    .option("--no-color", "disable colors");

// Register commands
program.addCommand(createBuildCommand());
program.addCommand(createCircularCommand());
program.addCommand(createCiCommand());
program.addCommand(createConfigCommand());
program.addCommand(createDepsCommand());
program.addCommand(createEnvCommand());
program.addCommand(createInitCommand());
program.addCommand(createKnipCommand());
program.addCommand(createPackageJsonCommand());
program.addCommand(createPublishCommand());
program.addCommand(createSchemaCommand());
program.addCommand(createTsconfigCommand());

// Custom help text
program.addHelpText(
    "after",
    `
Examples:
  $ mono init                           # Initialize configuration interactively
  $ mono init --defaults                # Initialize with default configuration
  $ mono deps check --all               # Check all dependency issues
  $ mono deps update -i                 # Interactive dependency updates
  $ mono tsconfig generate              # Generate TypeScript configs
  $ mono tsconfig generate --type=node  # Generate only node configs
  $ mono packagejson check              # Check package.json hygiene
  $ mono knip generate                  # Generate knip configs for all packages
  $ mono env encode .env --copy         # Base64 encode .env, copy to clipboard
  $ mono build --dry-run                # Preview build order
  $ mono ci mirror                      # Run typecheck + lint locally
  $ mono publish init my-pkg packages/my-pkg  # Init public repo

Documentation:
  Visit https://github.com/rad/mono for full documentation
`,
);

// Configure logger and load configuration before action
program.hook("preAction", async thisCommand => {
    const options = thisCommand.opts();

    // Configure logger
    logger.configure({
        verbose: options.verbose,
        silent: options.silent,
        noColor: !options.color,
    });

    // Load configuration (auto-discover or use provided path)
    try {
        const configManager = ConfigManager.getInstance();
        await configManager.init({
            cwd: options.cwd,
            configPath: options.config, // undefined = auto-search up directory tree
            validate: true,
        });

        // Make config available to commands through context
        thisCommand.setOptionValueWithSource("_config", configManager.getConfig(), "implied");

        if (options.verbose) {
            const configPath = configManager.getConfigPath();
            if (configPath) {
                logger.info(`Loaded configuration from: ${configPath}`);
            }
        }
    } catch (error) {
    // Only fail if config was explicitly provided but couldn't be loaded
        if (options.config) {
            logger.error(`Failed to load configuration: ${String(error)}`);
            process.exit(1);
        }
        // Otherwise continue without config (some commands may not need it)
        if (options.verbose) {
            logger.warn("No configuration file found, using defaults where applicable");
        }
    }
});

// Parse and execute
program.parse();
