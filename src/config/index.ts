/**
 * Configuration module exports
 */

/* eslint-disable no-barrel-files/no-barrel-files */

export {
    createConfigTemplate,
    generateJsonSchema,
    generateTypeScriptDefinitions,
    validateConfig,
    writeJsonSchemaToFile,
} from "./json-schema";

export {
    ConfigLoaderError,
    ConfigManager,
    ConfigValidationError,
    loadConfig,
    type LoadConfigOptions,
    loadConfigSync,
} from "./loader";

export {
    type CircularConfig,
    configSchema,
    DEFAULT_ESLINT_CONFIG_CONTENT,
    DEFAULT_REQUIRED_FILE_RULES,
    DEFAULT_TSCONFIG_MARKER_CONTENT,
    type DepsConfig,
    type FilesConfig,
    type KnipSchemaConfig,
    type MonorepoConfig,
    type PackageJsonConfig,
    type RequiredFileRule,
    type TazeConfig,
    type TsconfigConfig,
    type TsconfigContentConfig,
} from "./schema";
