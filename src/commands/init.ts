import { Command } from 'commander';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { question } from 'zx';
import { logger } from '../utils/logger.js';
import { createConfigTemplate } from '../config/json-schema.js';

interface InitOptions {
  defaults?: boolean;
  force?: boolean;
  output?: string;
}

async function promptForConfig() {
  logger.info('Welcome to monorepo-consistency configuration setup!\n');

  // Package manager
  const packageManager = await question(
    'Package manager (pnpm/npm/yarn)? [pnpm]: ',
    { choices: ['pnpm', 'npm', 'yarn'] }
  );

  // Workspace patterns
  const workspacePatterns = await question(
    'Workspace patterns (comma-separated)? [packages/*,apps/*]: '
  );

  // TypeScript config generation
  const enableTsconfig = await question(
    'Enable TypeScript config generation? [Y/n]: '
  );

  // Package.json hygiene
  const enablePackageJson = await question(
    'Enable package.json hygiene checks? [Y/n]: '
  );

  // Quality checks
  const enableQuality = await question(
    'Enable code quality checks (linting, type checking)? [Y/n]: '
  );

  // Dependency checks
  const enableDeps = await question(
    'Enable dependency checks? [Y/n]: '
  );

  // Taze runner
  const tazeRunner = await question(
    'Taze runner for dependency updates (npx/pnpx/yarn/bunx)? [pnpx]: ',
    { choices: ['npx', 'pnpx', 'yarn', 'bunx'] }
  );

  // Build configuration
  const config = {
    $schema: './monorepo.schema.json',
    version: '1.0.0',
    workspace: {
      packageManager: packageManager.trim() || 'pnpm',
      workspacePatterns: workspacePatterns.trim()
        ? workspacePatterns.split(',').map((p) => p.trim())
        : ['packages/*', 'apps/*'],
      ignoredWorkspaces: [],
    },
    deps: {
      taze: {
        runner: (tazeRunner.trim() || 'pnpx') as 'npx' | 'pnpx' | 'yarn' | 'bunx',
      },
      checkUnused: isYes(enableDeps),
      checkMissing: isYes(enableDeps),
      checkVersionMismatch: isYes(enableDeps),
      ignoredPackages: [],
      versionGroups: [
        {
          packages: ['packages/*'],
          dependencies: ['typescript', 'vitest', 'eslint'],
          policy: 'exact' as const,
        },
      ],
    },
    tsconfig: {
      enabled: isYes(enableTsconfig),
      types: ['web', 'node', 'builder'],
      configLocations: [
        '../config',
        '../../config',
        '../packages/config',
        '../../packages/config',
        '../../../packages/config',
        '../../../../packages/config',
      ],
      generateTypecheck: true,
      filterPathsByDependencies: true,
      excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**'],
      rootConfigDir: 'packages/config',
      validation: {
        checkMissing: true,
        checkExtends: true,
        checkConsistency: true,
        strictMode: false,
      },
    },
    packageJson: {
      enabled: isYes(enablePackageJson),
      scripts: {
        enforce: true,
        required: {},
        recommended: {
          build: 'unbuild',
          lint: 'eslint .',
          'lint:fix': 'eslint --fix .',
          types: 'tsc -p tsconfig.typecheck.json',
          test: 'vitest run',
        },
        forbidden: ['prepublish', 'prepublishOnly'],
        ignorePackages: [],
      },
      fields: {
        required: [
          'name',
          { field: 'version', default: '0.0.1' },
          { field: 'type', default: 'module' },
          {
            field: 'engines',
            default: {
              node: '>= 22',
              pnpm: '>= 10',
              npm: '>= 11',
            },
          },
          { field: 'private', default: true },
        ],
        forbidden: ['postinstall'],
      },
      consistency: {
        checkLicense: true,
        checkEngines: true,
        checkRepository: false,
        checkAuthor: false,
      },
      autoFix: {
        addMissingScripts: false,
        removeInvalidFields: false,
      },
    },
    quality: {
      linting: {
        enabled: isYes(enableQuality),
        fix: false,
      },
      typeChecking: {
        enabled: isYes(enableQuality),
        strict: true,
      },
      testing: {
        enabled: isYes(enableQuality),
        coverage: false,
        minCoverage: 80,
      },
    },
    catalog: {
      enabled: false,
      categories: [],
      generateDocs: false,
    },
    health: {
      checks: ['dependencies', 'quality'],
      failFast: false,
      reportFormat: 'markdown' as const,
    },
    ci: {
      enabled: false,
      failOnWarning: false,
    },
    output: {
      format: 'pretty' as const,
      verbose: false,
      silent: false,
    },
  };

  return config;
}

function isYes(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === '' || normalized === 'y' || normalized === 'yes';
}

export function createInitCommand(): Command {
  const command = new Command('init');

  command
    .description('Initialize monorepo configuration with interactive prompts or defaults')
    .option('--defaults', 'use default configuration without prompts')
    .option('-f, --force', 'overwrite existing configuration file')
    .option('-o, --output <path>', 'output file path', 'monorepo.config.json')
    .action(async (options: InitOptions) => {
      try {
        const cwd = command.optsWithGlobals().cwd || process.cwd();
        const outputPath = resolve(cwd, options.output || 'monorepo.config.json');

        // Check if config already exists
        if (existsSync(outputPath) && !options.force) {
          logger.error(
            `Configuration file already exists: ${outputPath}\n` +
              `Use --force to overwrite`
          );
          process.exit(1);
        }

        let config;

        if (options.defaults) {
          logger.info('Generating configuration with defaults...');
          config = createConfigTemplate();
        } else {
          config = await promptForConfig();
        }

        // Write configuration file
        writeFileSync(outputPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

        logger.success(`\n✓ Configuration file created: ${outputPath}`);
        logger.info('\nNext steps:');
        logger.info('  1. Review and customize monorepo.config.json');
        logger.info('  2. Run: mono schema --format json  (to generate JSON schema)');
        logger.info('  3. Run: mono health check  (to check your monorepo health)');
      } catch (error) {
        logger.error(`Failed to initialize configuration: ${String(error)}`);
        process.exit(1);
      }
    });

  return command;
}
