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
export { circularHandler } from "./domains/circular/index";
export { detectInterPackageCycles } from "./domains/circular/inter-package";
export { configHandler } from "./domains/config/index";
export { depsHandler } from "./domains/deps/index";
export { envHandler } from "./domains/env/index";
export { defaultKnipConfig, defineKnipConfig } from "./domains/knip/defaults";
export { knipHandler } from "./domains/knip/index";
export { packageJsonHandler } from "./domains/packagejson/index";
export { publishHandler } from "./domains/publish/index";
export {
    BASE_EXCLUDE,
    BASE_INCLUDE,
    BASE_WATCH_OPTIONS,
    BUILDER_COMPILER_OPTIONS,
    NODE_COMPILER_OPTIONS,
    SUPERBASE_COMPILER_OPTIONS,
    TYPECHECK_COMPILER_OPTIONS,
    WEB_COMPILER_OPTIONS,
} from "./domains/tsconfig/defaults";
export { tsconfigHandler } from "./domains/tsconfig/index";
export {
    buildBaseConfig,
    buildBuilderConfig,
    buildNodeConfig,
    buildTypecheckConfig,
    buildWebConfig,
} from "./runners/tsconfig";

// Export types
export * from "./types/index";

// Export utilities
export { findWorkspaceRoot, getWorkspaceInfo, loadPackageJson } from "./utils/workspace";

// Version
export const version = "1.0.0";
