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
} from "./json-schema.js";

export {
    ConfigLoaderError,
    ConfigManager,
    ConfigValidationError,
    loadConfig,
    type LoadConfigOptions,
    loadConfigSync,
} from "./loader.js";

export {
    configSchema,
    type DepsConfig,
    type MonorepoConfig,
    type PackageJsonConfig,
    type TazeConfig,
    type TsconfigConfig,
} from "./schema.js";
