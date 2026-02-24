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
    type DepsConfig,
    type KnipSchemaConfig,
    type MonorepoConfig,
    type PackageJsonConfig,
    type TazeConfig,
    type TsconfigConfig,
    type TsconfigContentConfig,
} from "./schema";
