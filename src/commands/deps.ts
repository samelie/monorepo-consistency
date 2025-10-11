import { Command, Option } from 'commander';
import { depsHandler } from '../domains/deps/index.js';
import { logger } from '../utils/logger.js';

export function createDepsCommand(): Command {
  const deps = new Command('deps')
    .description('Manage dependencies across workspace');

  // deps check
  deps
    .command('check')
    .description('Check for dependency issues')
    .option('--unused', 'find unused dependencies (knip)')
    .option('--mismatches', 'find version mismatches (syncpack)')
    .option('--outdated', 'find outdated packages')
    .option('--all', 'run all checks')
    .option('--json', 'output as JSON')
    .action(async (options) => {
      try {
        const result = await depsHandler.check(options);

        if (options.json) {
          logger.json(result);
        } else {
          if (result.issues.length === 0) {
            logger.success('No dependency issues found!');
          } else {
            logger.warn(`Found ${result.issues.length} dependency issues`);
            result.issues.forEach((issue) => {
              const prefix = issue.severity === 'critical' || issue.severity === 'high'
                ? '  ✗'
                : '  ⚠';
              logger.warn(`${prefix} [${issue.severity}] ${issue.message}`);
              if (issue.fix) {
                logger.info(`    Fix: ${issue.fix}`);
              }
            });
          }
        }

        process.exit(result.success ? 0 : 1);
      } catch (error) {
        logger.error(`Failed to check dependencies: ${error}`);
        process.exit(1);
      }
    });

  // deps fix
  deps
    .command('fix')
    .description('Fix dependency issues automatically')
    .option('--remove-unused', 'remove unused dependencies')
    .option('--fix-mismatches', 'fix version mismatches')
    .option('--dry-run', 'preview changes without applying')
    .action(async (options) => {
      try {
        const result = await depsHandler.fix(options);

        if (options.dryRun) {
          logger.info('Dry run - no changes applied');
        }

        if (result.changes.length === 0) {
          logger.info('No fixes needed');
        } else {
          logger.success(`Applied ${result.applied} fixes`);
          if (result.failed > 0) {
            logger.warn(`Failed to apply ${result.failed} fixes`);
          }
        }

        process.exit(result.success ? 0 : 1);
      } catch (error) {
        logger.error(`Failed to fix dependencies: ${error}`);
        process.exit(1);
      }
    });

  // deps update
  deps
    .command('update')
    .description('Update dependencies')
    .option('-i, --interactive', 'interactive mode (taze)')
    .option('--major', 'allow major version updates')
    .option('--minor', 'only minor updates')
    .option('--patch', 'only patch updates')
    .option('-w, --write', 'write updates directly to package.json')
    .option('--install', 'install dependencies after updating')
    .option('-r, --recursive', 'recursively update in workspace', true)
    .option('-l, --include-locked', 'include locked dependencies')
    .option('--all', 'show all packages (including up-to-date)')
    .option('--dry-run', 'preview updates without applying')
    .addOption(
      new Option('--filter <packages...>', 'filter specific packages').env(
        'MONO_FILTER'
      )
    )
    .addOption(
      new Option('--exclude <packages...>', 'exclude specific packages')
    )
    .action(async (options) => {
      try {
        await depsHandler.update(options);
      } catch (error) {
        logger.error(`Failed to update dependencies: ${error}`);
        process.exit(1);
      }
    });

  // deps preview
  deps
    .command('preview')
    .description('Preview available updates without applying them')
    .option('--major', 'show major version updates')
    .option('--minor', 'show minor updates')
    .option('--patch', 'show patch updates')
    .option('-l, --include-locked', 'include locked dependencies')
    .option('--json', 'output as JSON')
    .addOption(
      new Option('--filter <packages...>', 'filter specific packages')
    )
    .action(async (options) => {
      try {
        // Use update with dry-run and all flags
        await depsHandler.update({
          ...options,
          dryRun: true,
          all: true,
          write: false,
          interactive: false,
        });
      } catch (error) {
        logger.error(`Failed to preview updates: ${error}`);
        process.exit(1);
      }
    });

  // deps audit
  deps
    .command('audit')
    .description('Generate dependency audit report')
    .option('--format <type>', 'output format', 'table')
    .option('--output <file>', 'save to file')
    .action(async (options) => {
      try {
        await depsHandler.report(options);
      } catch (error) {
        logger.error(`Failed to generate audit: ${error}`);
        process.exit(1);
      }
    });

  return deps;
}