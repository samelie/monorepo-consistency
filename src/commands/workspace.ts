import { Command } from 'commander';
import { workspaceHandler } from '../domains/workspace/index.js';
import { logger } from '../utils/logger.js';

export function createWorkspaceCommand(): Command {
  const workspace = new Command('workspace')
    .alias('ws')
    .description('Workspace-level operations');

  workspace
    .command('list')
    .description('List all workspace packages')
    .option('--json', 'output as JSON')
    .option('--graph', 'show dependency graph')
    .action(async (options) => {
      try {
        const packages = await workspaceHandler.list(options);

        if (options.json) {
          logger.json(packages);
        } else if (options.graph) {
          logger.info('Dependency Graph:');
          // TODO: Format as graph
        } else {
          logger.info(`Found ${packages.length} packages in workspace:`);
          packages.forEach(pkg => {
            logger.info(`  - ${pkg.name} (${pkg.path})`);
          });
        }
      } catch (error) {
        logger.error(`Failed to list packages: ${error}`);
        process.exit(1);
      }
    });

  workspace
    .command('exec')
    .description('Execute command in all packages')
    .argument('<command...>', 'command to execute')
    .option('--parallel', 'run in parallel')
    .option('--filter <packages...>', 'filter packages')
    .action(async (command, options) => {
      try {
        await workspaceHandler.exec(command.join(' '), options);
        logger.success('Command executed successfully');
      } catch (error) {
        logger.error(`Command execution failed: ${error}`);
        process.exit(1);
      }
    });

  workspace
    .command('clean')
    .description('Clean workspace artifacts')
    .option('--node-modules', 'remove node_modules')
    .option('--dist', 'remove build outputs')
    .option('--cache', 'clear caches')
    .option('--all', 'remove all artifacts')
    .option('--dry-run', 'preview what will be removed')
    .action(async (options) => {
      try {
        const result = await workspaceHandler.clean(options);

        if (options.dryRun) {
          logger.info('Dry run - no files removed');
          logger.info(`Would remove ${result.files} files (${result.size} bytes)`);
        } else {
          logger.success(`Cleaned ${result.files} files (${result.size} bytes)`);
        }
      } catch (error) {
        logger.error(`Clean failed: ${error}`);
        process.exit(1);
      }
    });

  return workspace;
}