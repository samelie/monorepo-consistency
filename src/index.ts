/* eslint-disable no-barrel-files/no-barrel-files */

/**
 * @adddog/monorepo-consistency
 *
 * A comprehensive toolkit for maintaining consistency in pnpm monorepos
 */

// Export configuration
export * from "./config/index.js";

// Export domain handlers for programmatic use
export { buildHandler } from "./domains/build/index.js";
export { configHandler } from "./domains/config/index.js";
export { depsHandler } from "./domains/deps/index.js";
export { envHandler } from "./domains/env/index.js";
export { defaultKnipConfig, defineKnipConfig } from "./domains/knip/defaults.js";
export { knipHandler } from "./domains/knip/index.js";
export { packageJsonHandler } from "./domains/packagejson/index.js";
export { publishHandler } from "./domains/publish/index.js";
export { tsconfigHandler } from "./domains/tsconfig/index.js";

// Export types
export * from "./types/index.js";

// Export utilities
export { findWorkspaceRoot, getWorkspaceInfo, loadPackageJson } from "./utils/workspace.js";

// Version
export const version = "1.0.0";
