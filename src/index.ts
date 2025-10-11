/**
 * @adddog/monorepo-consistency
 *
 * A comprehensive toolkit for maintaining consistency in pnpm monorepos
 */

// Export types
export * from './types/index.js';

// Export domain handlers for programmatic use
export { depsHandler } from './domains/deps/index.js';
export { configHandler } from './domains/config/index.js';
export { qualityHandler } from './domains/security/quality/index.js';
export { healthHandler } from './domains/health/index.js';
export { workspaceHandler } from './domains/workspace/index.js';
export { tsconfigHandler } from './domains/tsconfig/index.js';
export { packageJsonHandler } from './domains/packagejson/index.js';

// Export utilities
export { logger } from './utils/logger.js';
export { getWorkspaceInfo, findWorkspaceRoot, loadPackageJson } from './utils/workspace.js';

// Export configuration
export * from './config/index.js';

// Version
export const version = '1.0.0';
