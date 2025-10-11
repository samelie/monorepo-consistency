import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { minimatch } from 'minimatch';
import type { CheckResult, CommandOptions, FixResult, Issue, Change } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { getWorkspaceInfo } from '../../utils/workspace.js';
import { ConfigManager } from '../../config/loader.js';

interface PackageJsonCheckOptions extends CommandOptions {
  scripts?: boolean;
  fields?: boolean;
  consistency?: boolean;
  all?: boolean;
}

interface PackageJsonFixOptions extends CommandOptions {
  addScripts?: boolean;
  addFields?: boolean;
  removeFields?: boolean;
}

/**
 * Check if a package should be ignored based on config patterns
 */
const shouldIgnorePackage = (packageName: string, ignorePatterns: string[]): boolean => {
  return ignorePatterns.some(pattern => minimatch(packageName, pattern));
};

/**
 * Check script consistency across packages
 */
const checkScripts = async (options: PackageJsonCheckOptions): Promise<Issue[]> => {
  const config = ConfigManager.getInstance().getConfig();
  const scriptConfig = config.packageJson?.scripts;

  if (!scriptConfig || !scriptConfig.enforce) {
    return [];
  }

  const workspace = await getWorkspaceInfo(options.cwd);
  const issues: Issue[] = [];

  for (const pkg of workspace.packages) {
    // Skip ignored packages
    if (shouldIgnorePackage(pkg.name, scriptConfig.ignorePackages || [])) {
      logger.debug(`Skipping ignored package: ${pkg.name}`);
      continue;
    }

    const scripts = pkg.scripts || {};

    // Check required scripts
    for (const [scriptName, scriptCommand] of Object.entries(scriptConfig.required || {})) {
      if (!scripts[scriptName]) {
        issues.push({
          severity: 'high',
          type: 'missing-script',
          package: pkg.name,
          file: `${pkg.path}/package.json`,
          message: `Missing required script: "${scriptName}"`,
          fix: `Add: "scripts": { "${scriptName}": "${scriptCommand}" }`,
        });
      } else if (scripts[scriptName] !== scriptCommand) {
        issues.push({
          severity: 'medium',
          type: 'script-mismatch',
          package: pkg.name,
          file: `${pkg.path}/package.json`,
          message: `Script "${scriptName}" differs from standard: "${scripts[scriptName]}" vs "${scriptCommand}"`,
          fix: `Update to: "${scriptCommand}"`,
        });
      }
    }

    // Check recommended scripts (warning level)
    for (const [scriptName, scriptCommand] of Object.entries(scriptConfig.recommended || {})) {
      if (!scripts[scriptName]) {
        issues.push({
          severity: 'low',
          type: 'missing-recommended-script',
          package: pkg.name,
          file: `${pkg.path}/package.json`,
          message: `Missing recommended script: "${scriptName}"`,
          fix: `Consider adding: "scripts": { "${scriptName}": "${scriptCommand}" }`,
        });
      }
    }

    // Check forbidden scripts
    for (const scriptName of scriptConfig.forbidden || []) {
      if (scripts[scriptName]) {
        issues.push({
          severity: 'high',
          type: 'forbidden-script',
          package: pkg.name,
          file: `${pkg.path}/package.json`,
          message: `Forbidden script found: "${scriptName}"`,
          fix: `Remove this script`,
        });
      }
    }
  }

  return issues;
};

/**
 * Normalize required field entry to extract field name and default value
 */
const normalizeFieldEntry = (
  entry: string | { field: string; default?: unknown }
): { field: string; default?: unknown } => {
  if (typeof entry === 'string') {
    return { field: entry };
  }
  return entry;
};

/**
 * Check field requirements and validation
 */
const checkFields = async (options: PackageJsonCheckOptions): Promise<Issue[]> => {
  const config = ConfigManager.getInstance().getConfig();
  const fieldConfig = config.packageJson?.fields;

  if (!fieldConfig) {
    return [];
  }

  const workspace = await getWorkspaceInfo(options.cwd);
  const issues: Issue[] = [];

  for (const pkg of workspace.packages) {
    const pkgJsonPath = join(pkg.path, 'package.json');
    const content = await readFile(pkgJsonPath, 'utf-8');
    const pkgJson = JSON.parse(content) as Record<string, unknown>;

    // Check required fields
    for (const fieldEntry of fieldConfig.required || []) {
      const { field, default: defaultValue } = normalizeFieldEntry(fieldEntry);

      if (!(field in pkgJson)) {
        const fixMessage = defaultValue !== undefined
          ? `Add "${field}" to package.json with default: ${JSON.stringify(defaultValue)}`
          : `Add "${field}" to package.json`;

        issues.push({
          severity: 'high',
          type: 'missing-field',
          package: pkg.name,
          file: pkgJsonPath,
          message: `Missing required field: "${field}"`,
          fix: fixMessage,
        });
      }
    }

    // Check forbidden fields
    for (const field of fieldConfig.forbidden || []) {
      if (field in pkgJson) {
        issues.push({
          severity: 'medium',
          type: 'forbidden-field',
          package: pkg.name,
          file: pkgJsonPath,
          message: `Forbidden field found: "${field}"`,
          fix: `Remove "${field}" from package.json`,
        });
      }
    }
  }

  return issues;
};

/**
 * Check consistency across packages
 */
const checkConsistency = async (options: PackageJsonCheckOptions): Promise<Issue[]> => {
  const config = ConfigManager.getInstance().getConfig();
  const consistencyConfig = config.packageJson?.consistency;

  if (!consistencyConfig) {
    return [];
  }

  const workspace = await getWorkspaceInfo(options.cwd);
  const issues: Issue[] = [];

  // Collect all licenses
  const licenses = new Map<string, string[]>();

  for (const pkg of workspace.packages) {
    const pkgJsonPath = join(pkg.path, 'package.json');
    const content = await readFile(pkgJsonPath, 'utf-8');
    const pkgJson = JSON.parse(content) as Record<string, unknown>;

    // Check license consistency
    if (consistencyConfig.checkLicense && pkgJson.license) {
      const license = String(pkgJson.license);
      if (!licenses.has(license)) {
        licenses.set(license, []);
      }
      licenses.get(license)!.push(pkg.name);
    }

    // Check engines field
    if (consistencyConfig.checkEngines && !pkgJson.engines) {
      issues.push({
        severity: 'low',
        type: 'missing-engines',
        package: pkg.name,
        file: pkgJsonPath,
        message: 'Missing "engines" field',
        fix: 'Add "engines" field with Node.js version requirement',
      });
    }
  }

  // If multiple licenses found, report inconsistency
  if (consistencyConfig.checkLicense && licenses.size > 1) {
    const licenseList = Array.from(licenses.entries())
      .map(([license, pkgs]) => `${license} (${pkgs.length} packages)`)
      .join(', ');

    issues.push({
      severity: 'medium',
      type: 'inconsistent-license',
      message: `Multiple licenses found across workspace: ${licenseList}`,
      fix: 'Standardize license across all packages',
    });
  }

  return issues;
};

/**
 * Main check function
 */
export const check = async (options: PackageJsonCheckOptions): Promise<CheckResult> => {
  const spinner = logger.spinner('Checking package.json hygiene...');
  spinner.start();

  try {
    const checkPromises: Promise<Issue[]>[] = [];

    if (options.scripts || options.all) {
      checkPromises.push(checkScripts(options));
    }

    if (options.fields || options.all) {
      checkPromises.push(checkFields(options));
    }

    if (options.consistency || options.all) {
      checkPromises.push(checkConsistency(options));
    }

    const issueArrays = await Promise.all(checkPromises);
    const issues = issueArrays.flat();

    const stats = {
      total: issues.length,
      critical: issues.filter(i => i.severity === 'critical').length,
      high: issues.filter(i => i.severity === 'high').length,
      medium: issues.filter(i => i.severity === 'medium').length,
      low: issues.filter(i => i.severity === 'low').length,
    };

    spinner.succeed('Package.json hygiene check complete');

    return {
      success: stats.critical === 0,
      issues,
      stats,
    };
  } catch (error) {
    spinner.fail('Package.json hygiene check failed');
    throw error;
  }
};

/**
 * Auto-fix package.json issues
 */
export const fix = async (options: PackageJsonFixOptions): Promise<FixResult> => {
  const spinner = logger.spinner('Fixing package.json issues...');
  spinner.start();

  try {
    const config = ConfigManager.getInstance().getConfig();
    const autoFixConfig = config.packageJson?.autoFix;
    const scriptConfig = config.packageJson?.scripts;
    const fieldConfig = config.packageJson?.fields;

    if (!autoFixConfig) {
      spinner.info('No auto-fix configuration found');
      return {
        success: true,
        applied: 0,
        failed: 0,
        changes: [],
      };
    }

    const changes: Change[] = [];
    const workspace = await getWorkspaceInfo(options.cwd);

    for (const pkg of workspace.packages) {
      const pkgJsonPath = join(pkg.path, 'package.json');
      const content = await readFile(pkgJsonPath, 'utf-8');
      const pkgJson = JSON.parse(content) as Record<string, unknown>;
      let modified = false;

      // Check if package should be ignored for script fixes
      const isIgnoredForScripts = scriptConfig && shouldIgnorePackage(pkg.name, scriptConfig.ignorePackages || []);

      // Add missing required scripts
      if (options.addScripts && !isIgnoredForScripts && autoFixConfig.addMissingScripts && scriptConfig?.required) {
        const scripts = (pkgJson.scripts || {}) as Record<string, string>;

        for (const [scriptName, scriptCommand] of Object.entries(scriptConfig.required)) {
          if (!scripts[scriptName]) {
            scripts[scriptName] = scriptCommand;
            modified = true;

            changes.push({
              type: 'add-script',
              package: pkg.name,
              file: pkgJsonPath,
              description: `Added required script: "${scriptName}"`,
              after: scriptCommand,
            });
          }
        }

        pkgJson.scripts = scripts;
      }

      // Add missing required fields
      if (options.addFields && fieldConfig?.required) {
        for (const fieldEntry of fieldConfig.required) {
          const { field, default: defaultValue } = normalizeFieldEntry(fieldEntry);

          if (!(field in pkgJson) && defaultValue !== undefined) {
            pkgJson[field] = defaultValue;
            modified = true;

            changes.push({
              type: 'add-field',
              package: pkg.name,
              file: pkgJsonPath,
              description: `Added required field: "${field}"`,
              after: JSON.stringify(defaultValue),
            });
          }
        }
      }

      // Remove forbidden fields
      if (options.removeFields && autoFixConfig.removeInvalidFields && fieldConfig?.forbidden) {
        for (const field of fieldConfig.forbidden) {
          if (field in pkgJson) {
            delete pkgJson[field];
            modified = true;

            changes.push({
              type: 'remove-field',
              package: pkg.name,
              file: pkgJsonPath,
              description: `Removed forbidden field: "${field}"`,
            });
          }
        }
      }

      // Write back if modified
      if (modified && !options.dryRun) {
        await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf-8');
      }
    }

    spinner.succeed(`Package.json fixes applied: ${changes.length} changes`);

    return {
      success: true,
      applied: changes.length,
      failed: 0,
      changes,
    };
  } catch (error) {
    spinner.fail('Package.json fix failed');
    throw error;
  }
};

// Export handler object for consistency with command structure
export const packageJsonHandler = {
  check,
  fix,
};
