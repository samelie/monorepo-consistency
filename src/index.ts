/* eslint-disable no-barrel-files/no-barrel-files */

/**
 * @adddog/monorepo-consistency
 *
 * A comprehensive toolkit for maintaining consistency in pnpm monorepos
 */

// Export configuration
export * from "./config/index";

// Export domain handlers for programmatic use
export { buildHandler } from "./domains/build/index";
export { configHandler } from "./domains/config/index";
export { depsHandler } from "./domains/deps/index";
export { envHandler } from "./domains/env/index";
export { defaultKnipConfig, defineKnipConfig } from "./domains/knip/defaults";
export { knipHandler } from "./domains/knip/index";
export { packageJsonHandler } from "./domains/packagejson/index";
export { publishHandler } from "./domains/publish/index";
export { tsconfigHandler } from "./domains/tsconfig/index";

// Export types
export * from "./types/index";

// Export utilities
export { findWorkspaceRoot, getWorkspaceInfo, loadPackageJson } from "./utils/workspace";

// Version
export const version = "1.0.0";
