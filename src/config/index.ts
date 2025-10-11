/**
 * Configuration module exports
 */

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
    type CatalogConfig,
    configSchema,
    type DepsConfig,
    type HealthConfig,
    type MonorepoConfig,
    type QualityConfig,
    type TazeConfig,
    type WorkspaceConfig,
} from "./schema.js";
