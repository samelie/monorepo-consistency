import type { CommandOptions, FixResult, ReportOptions, Issue } from '../../types/index.js';
import * as logger from '../../utils/logger.js';
import * as deps from '../deps/index.js';
import * as config from '../config/index.js';
import * as quality from '../security/quality/index.js';

interface HealthCheckOptions extends CommandOptions {
  quick?: boolean;
  detailed?: boolean;
}

interface HealthFixOptions extends CommandOptions {
  priority?: 'critical' | 'high' | 'all';
}

interface HealthResult {
  success: boolean;
  score: number;
  categories: Record<string, CategoryResult>;
  issues: Issue[];
}

interface CategoryResult {
  score: number;
  issues: number;
  critical: number;
  high: number;
}

// Pure functions for health operations

const calculateCategoryScore = (issues: Issue[]): CategoryResult => {
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const highCount = issues.filter(i => i.severity === 'high').length;

  const score = issues.length === 0
    ? 100
    : Math.max(0, 100 - (criticalCount * 30) - (highCount * 20) - ((issues.length - criticalCount - highCount) * 5));

  return {
    score,
    issues: issues.length,
    critical: criticalCount,
    high: highCount,
  };
};

export const check = async (options: HealthCheckOptions): Promise<HealthResult> => {
  const spinner = logger.spinner('Running comprehensive health check...');
  spinner.start();

  try {
    const categories: Record<string, CategoryResult> = {};
    const allIssues: Issue[] = [];

    // Run all checks in parallel for speed
    const checkResults = await Promise.allSettled([
      options.quick ? Promise.resolve(null) : deps.check({ ...options, all: true }),
      config.check({ ...options, all: true }),
      quality.check({ ...options, all: true }),
    ]);

    // Process dependency results
    if (checkResults[0].status === 'fulfilled' && checkResults[0].value) {
      const result = checkResults[0].value;
      categories['Dependencies'] = calculateCategoryScore(result.issues);
      allIssues.push(...result.issues);
    }

    // Process config results
    if (checkResults[1].status === 'fulfilled' && checkResults[1].value) {
      const result = checkResults[1].value;
      categories['Configuration'] = calculateCategoryScore(result.issues);
      allIssues.push(...result.issues);
    }

    // Process quality results
    if (checkResults[2].status === 'fulfilled' && checkResults[2].value) {
      const result = checkResults[2].value;
      categories['Code Quality'] = calculateCategoryScore(result.issues);
      allIssues.push(...result.issues);
    }

    // Calculate overall score
    const scores = Object.values(categories).map(c => c.score);
    const overallScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 100;

    spinner.succeed('Health check complete');

    return {
      success: overallScore >= 80,
      score: overallScore,
      categories,
      issues: allIssues,
    };
  } catch (error) {
    spinner.fail('Health check failed');
    throw error;
  }
};

export const report = async (options: ReportOptions): Promise<void> => {
  const spinner = logger.spinner('Generating health report...');
  spinner.start();

  try {
    await check({ ...options, detailed: true });

    // TODO: Format report based on options.format
    // - terminal: console output with colors
    // - html: generate HTML dashboard
    // - json: structured JSON output

    spinner.succeed('Report generated');

    if (options.output) {
      // TODO: Save report to file
      logger.debug(`Saving report to ${options.output}`);
    }
  } catch (error) {
    spinner.fail('Report generation failed');
    throw error;
  }
};

export const fix = async (options: HealthFixOptions): Promise<FixResult> => {
  const spinner = logger.spinner('Applying fixes across all categories...');
  spinner.start();

  try {
    const changes = [];
    let applied = 0;
    let failed = 0;

    // Run fixes based on priority
    if (options.priority === 'high' || options.priority === 'all') {
      // Fix configuration issues
      logger.debug('Fixing configuration issues...');
      const configFix = await config.fix({
        ...options,
        addMissing: true,
        updateScripts: true
      });
      applied += configFix.applied;
      failed += configFix.failed;
      changes.push(...configFix.changes);

      // Fix dependency issues
      logger.debug('Fixing dependency issues...');
      const depsFix = await deps.fix({
        ...options,
        fixMismatches: true
      });
      applied += depsFix.applied;
      failed += depsFix.failed;
      changes.push(...depsFix.changes);
    }

    if (options.priority === 'all') {
      // Fix quality issues
      logger.debug('Fixing quality issues...');
      const qualityFix = await quality.fix({
        ...options,
        lint: true,
        format: true
      });
      applied += qualityFix.applied;
      failed += qualityFix.failed;
      changes.push(...qualityFix.changes);
    }

    spinner.succeed('Fixes applied');

    return {
      success: failed === 0,
      applied,
      failed,
      changes,
    };
  } catch (error) {
    spinner.fail('Fix application failed');
    throw error;
  }
};

// Export handler object for consistency with command structure
export const healthHandler = {
  check,
  report,
  fix,
};
