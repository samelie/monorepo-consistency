/**
 * Configuration module exports
 */

export {
  configSchema,
  type MonorepoConfig,
  type DepsConfig,
  type QualityConfig,
  type WorkspaceConfig,
  type CatalogConfig,
  type HealthConfig,
  type TazeConfig,
} from './schema.js';

export {
  loadConfig,
  loadConfigSync,
  ConfigManager,
  ConfigLoaderError,
  ConfigValidationError,
  type LoadConfigOptions,
} from './loader.js';

export {
  generateJsonSchema,
  writeJsonSchemaToFile,
  generateTypeScriptDefinitions,
  createConfigTemplate,
  validateConfig,
} from './json-schema.js';