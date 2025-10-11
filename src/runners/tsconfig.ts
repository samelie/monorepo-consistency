import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import glob from 'fast-glob';
import merge from 'lodash/merge.js';
import { getTsconfig } from 'get-tsconfig';

/**
 * Extract all dependency package names from package.json
 */
function extractDependencies(packageJsonPath: string): Set<string> {
  const dependencies = new Set<string>();

  try {
    const pkgJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    if (pkgJson.dependencies) {
      for (const dep of Object.keys(pkgJson.dependencies)) {
        dependencies.add(dep);
      }
    }

    if (pkgJson.devDependencies) {
      for (const dep of Object.keys(pkgJson.devDependencies)) {
        dependencies.add(dep);
      }
    }
  } catch (error) {
    // If we can't read package.json, return empty set
    // This will result in no filtering
  }

  return dependencies;
}

/**
 * Filter compilerOptions.paths to only include paths for packages
 * that are actually dependencies in package.json
 */
function filterPathsByDependencies(
  tsConfig: Record<string, unknown>,
  dependencies: Set<string>
): Record<string, unknown> {
  const compilerOptions = tsConfig.compilerOptions as Record<string, unknown> | undefined;

  if (!compilerOptions?.paths) {
    return tsConfig;
  }

  const paths = compilerOptions.paths as Record<string, unknown>;
  const filteredPaths: Record<string, unknown> = {};

  for (const [pathKey, pathValue] of Object.entries(paths)) {
    // Extract package name from path key (e.g., "@rad/env" from "@rad/env" or "@rad/build-configs/*")
    const packageName = pathKey.replace(/\/\*$/, '');

    // Keep the path if:
    // 1. It's in dependencies/devDependencies, OR
    // 2. It's not a scoped package (e.g., "src*", not starting with "@")
    if (dependencies.has(packageName) || !packageName.startsWith('@')) {
      filteredPaths[pathKey] = pathValue;
    }
  }

  return {
    ...tsConfig,
    compilerOptions: {
      ...compilerOptions,
      paths: filteredPaths,
    },
  };
}

/**
 * TypeScript config generation options
 */
export interface TsconfigGenerateOptions {
  /** Root directory to scan */
  rootDir: string;

  /** Config types to generate */
  types?: TsconfigType[];

  /** Dry run - don't write files */
  dryRun?: boolean;

  /** Force overwrite existing configs */
  force?: boolean;

  /** Verbose logging */
  verbose?: boolean;
}

export type TsconfigType = 'web' | 'node' | 'builder';

export interface TsconfigGenerateResult {
  success: boolean;
  generated: GeneratedConfig[];
  errors: GenerationError[];
}

export interface GeneratedConfig {
  type: TsconfigType;
  path: string;
  basePath: string;
}

export interface GenerationError {
  path: string;
  error: string;
}

/**
 * TypeScript configuration templates resolved from config directory
 */
interface ResolvedTemplates {
  web: string;
  node: string;
  builder: string;
  webTs: Record<string, unknown>;
  nodeTs: Record<string, unknown>;
  builderTs: Record<string, unknown>;
}

/**
 * Possible locations for app-specific configs relative to a package
 */
const POSSIBLE_APP_CONFIG_LOCATIONS = [
  '../config',
  '../../config',
  '../packages/config',
  '../../packages/config',
  '../../../packages/config',
  '../../../../packages/config',
] as const;

/**
 * Recursively extract and merge config from extends chain
 */
function extractConfigFromExtends(
  configPath: string,
  accumulated: Record<string, unknown> = {}
): Record<string, unknown> {
  const currentConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as {
    extends?: string;
    [key: string]: unknown;
  };

  if (currentConfig.extends) {
    const extendedPath = join(parse(configPath).dir, currentConfig.extends);
    accumulated = extractConfigFromExtends(extendedPath, accumulated);

    const configToMerge = { ...currentConfig };
    delete configToMerge.extends;
    accumulated = merge(accumulated, configToMerge);
  } else {
    accumulated = merge(accumulated, currentConfig);
  }

  return accumulated;
}

/**
 * Find root config templates in the monorepo
 */
function findRootTemplates(packageJsonFiles: string[]): ResolvedTemplates {
  const rootTs: {
    web: string;
    node: string;
    builder: string;
  } = {
    web: '',
    node: '',
    builder: '',
  };

  // Find shortest paths to each config type (closest to root)
  for (const pjson of packageJsonFiles) {
    const dir = parse(pjson).dir;
    if (!dir.includes('/config')) continue;

    const webTs = join(dir, 'web.tsconfig.json');
    const nodeTs = join(dir, 'node.tsconfig.json');
    const builderTs = join(dir, 'builder.tsconfig.json');

    if (existsSync(webTs) && (!rootTs.web || webTs.length < rootTs.web.length)) {
      rootTs.web = webTs;
    }
    if (existsSync(nodeTs) && (!rootTs.node || nodeTs.length < rootTs.node.length)) {
      rootTs.node = nodeTs;
    }
    if (existsSync(builderTs) && (!rootTs.builder || builderTs.length < rootTs.builder.length)) {
      rootTs.builder = builderTs;
    }
  }

  return {
    ...rootTs,
    webTs: rootTs.web ? extractConfigFromExtends(rootTs.web) : {},
    nodeTs: rootTs.node ? extractConfigFromExtends(rootTs.node) : {},
    builderTs: rootTs.builder ? extractConfigFromExtends(rootTs.builder) : {},
  };
}

/**
 * Generate TypeScript configurations for all packages in the monorepo
 */
export async function generateTsconfigs(
  options: TsconfigGenerateOptions
): Promise<TsconfigGenerateResult> {
  const { rootDir, types, dryRun = false, force: _force = false, verbose = false } = options;

  const result: TsconfigGenerateResult = {
    success: true,
    generated: [],
    errors: [],
  };

  // Find all package.json files
  const packageJsonFiles = await glob('**/package.json', {
    cwd: rootDir,
    absolute: false,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
  });

  if (verbose) {
    process.stdout.write(JSON.stringify(packageJsonFiles, null, 2) + '\n');
  }

  // Find root templates (need absolute paths for this)
  const absolutePackageJsonFiles = packageJsonFiles.map(p => join(rootDir, p));
  const templates = findRootTemplates(absolutePackageJsonFiles);

  // Process each package
  for (const pjsonPath of packageJsonFiles) {
    const dir = join(rootDir, parse(pjsonPath).dir);
    const targetTs = join(dir, 'tsconfig.json');
    const targetTypecheck = join(dir, 'tsconfig.typecheck.json');
    const packageJsonFullPath = join(rootDir, pjsonPath);

    // Skip the root config directory itself
    if (dir === join(rootDir, 'packages/config')) {
      continue;
    }

    // Extract dependencies from package.json for path filtering
    const dependencies = extractDependencies(packageJsonFullPath);

    // Check for local config overrides
    const localWebTs = join(dir, 'web.tsconfig.json');
    const localNodeTs = join(dir, 'node.tsconfig.json');
    const localBuilderTs = join(dir, 'builder.tsconfig.json');

    // Try to find nearest config template
    for (const relativeConfigPath of POSSIBLE_APP_CONFIG_LOCATIONS) {
      const nearestWebTs = join(dir, relativeConfigPath, 'web.tsconfig.json');
      const nearestNodeTs = join(dir, relativeConfigPath, 'node.tsconfig.json');
      const nearestBuilderTs = join(dir, relativeConfigPath, 'builder.tsconfig.json');

      // Node config
      if (
        existsSync(localNodeTs) &&
        existsSync(nearestNodeTs) &&
        (!types || types.includes('node'))
      ) {
        try {
          const extractedConfig = extractConfigFromExtends(nearestNodeTs);
          const localConfig = JSON.parse(readFileSync(localNodeTs, 'utf-8'));
          let ts = merge({}, extractedConfig, localConfig);

          delete ts.extends;

          // Filter paths based on package.json dependencies
          ts = filterPathsByDependencies(ts, dependencies);

          if (verbose) {
            process.stdout.write(`writing Node 🧪 ${targetTs} 📝 (base: ${nearestNodeTs})\n`);
          }

          if (!dryRun) {
            writeFileSync(targetTs, JSON.stringify(ts, null, 4), 'utf-8');
          }

          result.generated.push({
            type: 'node',
            path: targetTs,
            basePath: nearestNodeTs,
          });

          break;
        } catch (error) {
          result.errors.push({
            path: targetTs,
            error: String(error),
          });
          result.success = false;
        }
      }

      // Web config
      if (
        existsSync(localWebTs) &&
        existsSync(nearestWebTs) &&
        (!types || types.includes('web'))
      ) {
        try {
          const extractedConfig = extractConfigFromExtends(nearestWebTs);
          const localConfig = JSON.parse(readFileSync(localWebTs, 'utf-8'));
          let ts = merge({}, extractedConfig, localConfig);

          delete ts.extends;

          // Filter paths based on package.json dependencies
          ts = filterPathsByDependencies(ts, dependencies);

          if (verbose) {
            process.stdout.write(`writing Web 🕸️ ${targetTs} 📝 (base: ${nearestWebTs})\n`);
          }

          if (!dryRun) {
            writeFileSync(targetTs, JSON.stringify(ts, null, 4), 'utf-8');
          }

          result.generated.push({
            type: 'web',
            path: targetTs,
            basePath: nearestWebTs,
          });

          break;
        } catch (error) {
          result.errors.push({
            path: targetTs,
            error: String(error),
          });
          result.success = false;
        }
      }

      // Builder config
      if (
        existsSync(localBuilderTs) &&
        existsSync(nearestBuilderTs) &&
        (!types || types.includes('builder'))
      ) {
        try {
          const ts = merge(
            {},
            getTsconfig(targetTs)?.config,
            templates.builderTs,
          );

          delete ts.references;
          delete ts.watchOptions;
          delete ts.extends;

          if (verbose) {
            process.stdout.write(`writing Builder 🏗️ ${targetTs} 📝 (base: ${nearestBuilderTs})\n`);
          }

          if (!dryRun) {
            writeFileSync(localBuilderTs, JSON.stringify(ts, null, 4), 'utf-8');
          }

          result.generated.push({
            type: 'builder',
            path: localBuilderTs,
            basePath: nearestBuilderTs,
          });

          break;
        } catch (error) {
          if (verbose) {
            process.stdout.write(`writing Builder 🏗ERROR ${targetTs} ${localBuilderTs} ${nearestBuilderTs} ${error}\n`);
          }
          result.errors.push({
            path: localBuilderTs,
            error: String(error),
          });
          result.success = false;
        }
      }

      // Typecheck config (always write)
      if (verbose) {
        process.stdout.write(`writing TypeCheck 🔍 ${targetTypecheck} 📝 \n`);
      }

      if (!dryRun) {
        writeFileSync(
          targetTypecheck,
          JSON.stringify(
            {
              extends: './tsconfig.json',
              compilerOptions: {
                noEmit: true,
                composite: false,
                declaration: false,
                declarationDir: null,
                emitDeclarationOnly: false,
                skipLibCheck: true,
              },
            },
            null,
            4
          ),
          'utf-8'
        );
      }
    }
  }

  return result;
}
