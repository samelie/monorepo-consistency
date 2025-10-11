#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from './utils/logger.js';
import { ConfigManager } from './config/loader.js';
import { createDepsCommand } from './commands/deps.js';
import { createConfigCommand } from './commands/config.js';
import { createQualityCommand } from './commands/quality.js';
import { createHealthCommand } from './commands/health.js';
import { createWorkspaceCommand } from './commands/workspace.js';
import { createSchemaCommand } from './commands/schema.js';
import { createTsconfigCommand } from './commands/tsconfig.js';
import { createPackageJsonCommand } from './commands/packagejson.js';
import { createInitCommand } from './commands/init.js';

const program = new Command();

// Main program configuration
program
  .name('mono')
  .description('Monorepo consistency and maintenance toolkit')
  .version('1.0.0')
  .configureHelp({
    sortSubcommands: true,
    subcommandTerm: (cmd) => cmd.name(),
  });

// Global options
program
  .option('--cwd <path>', 'working directory', process.cwd())
  .option('-c, --config <path>', 'configuration file path')
  .option('--verbose', 'verbose output')
  .option('--silent', 'suppress output')
  .option('--no-color', 'disable colors');

// Register commands
program.addCommand(createInitCommand());
program.addCommand(createDepsCommand());
program.addCommand(createConfigCommand());
program.addCommand(createQualityCommand());
program.addCommand(createHealthCommand());
program.addCommand(createWorkspaceCommand());
program.addCommand(createSchemaCommand());
program.addCommand(createTsconfigCommand());
program.addCommand(createPackageJsonCommand());

// Custom help text
program.addHelpText(
  'after',
  `
Examples:
  $ mono init                           # Initialize configuration interactively
  $ mono init --defaults                # Initialize with default configuration
  $ mono health check                   # Quick health check
  $ mono deps check --all               # Check all dependency issues
  $ mono deps update -i                 # Interactive dependency updates
  $ mono tsconfig generate              # Generate TypeScript configs
  $ mono tsconfig generate --type=node  # Generate only node configs
  $ mono workspace exec "pnpm build"    # Build all packages

Documentation:
  Visit https://github.com/rad/mono for full documentation
`
);

// Configure logger and load configuration before action
program.hook('preAction', async (thisCommand) => {
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
    thisCommand.setOptionValueWithSource('_config', configManager.getConfig(), 'implied');

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
      logger.warn('No configuration file found, using defaults where applicable');
    }
  }
});

// Parse and execute
program.parse();
