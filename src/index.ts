/* eslint-disable no-barrel-files/no-barrel-files */

/**
 * @adddog/monorepo-consistency
 *
 * A comprehensive toolkit for maintaining consistency in pnpm monorepos
 */

// Export configuration
export * from "./config/index.js";

export { configHandler } from "./domains/config/index.js";
// Export domain handlers for programmatic use
export { depsHandler } from "./domains/deps/index.js";
export { healthHandler } from "./domains/health/index.js";
export { packageJsonHandler } from "./domains/packagejson/index.js";
export { qualityHandler } from "./domains/security/quality/index.js";
export { tsconfigHandler } from "./domains/tsconfig/index.js";
export { workspaceHandler } from "./domains/workspace/index.js";

// Export types
export * from "./types/index.js";

// Export utilities
export { findWorkspaceRoot, getWorkspaceInfo, loadPackageJson } from "./utils/workspace.js";

// Version
export const version = "1.0.0";
