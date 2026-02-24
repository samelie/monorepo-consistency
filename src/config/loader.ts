import type { MonorepoConfig } from "./schema";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { z } from "zod/v3";
import { configSchema } from "./schema";

/**
 * Configuration loader error
 */
export class ConfigLoaderError extends Error {
    readonly path?: string;
    override readonly cause?: unknown;

    constructor(
        message: string,
        path?: string,
        cause?: unknown,
    ) {
        super(message);
        this.name = "ConfigLoaderError";
        this.path = path;
        this.cause = cause;
    }
}

/**
 * Configuration validation error with detailed issues
 */
export class ConfigValidationError extends ConfigLoaderError {
    readonly issues: z.ZodIssue[];

    constructor(
        issues: z.ZodIssue[],
        path?: string,
    ) {
        const message = `Configuration validation failed:\n${issues
            .map(issue => `  - ${issue.path.join(".")}: ${issue.message}`)
            .join("\n")}`;
        super(message, path);
        this.name = "ConfigValidationError";
        this.issues = issues;
    }
}

/**
 * Supported configuration file formats
 */
const CONFIG_EXTENSIONS = [".json", "", ".mjs", ".ts", ".mts"] as const;
type ConfigExtension = typeof CONFIG_EXTENSIONS[number];

/**
 * Default configuration file names
 */
const DEFAULT_CONFIG_NAMES = [
    "monorepo.config",
    ".monoreporc",
    "mono.config",
] as const;

/**
 * Configuration loader options
 */
export interface LoadConfigOptions {
    /** Working directory */
    cwd?: string;
    /** Config file path (absolute or relative to cwd) */
    configPath?: string;
    /** Whether to validate the configuration */
    validate?: boolean;
    /** Allow partial configuration (missing required fields) */
    partial?: boolean;
    /** Merge with default configuration */
    defaults?: Partial<MonorepoConfig>;
}

/**
 * Type guard to check if value is an object with extends property
 */
function hasExtendsProperty(value: unknown): value is { extends?: string | string[] } & Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * Type guard to check if value is a package.json with monorepo field
 */
function hasMonorepoField(value: unknown): value is { monorepo: unknown } {
    return typeof value === "object" && value !== null && "monorepo" in value;
}

/**
 * Load a configuration file
 */
async function loadConfigFile(filePath: string): Promise<unknown> {
    const ext = extname(filePath) as ConfigExtension;

    switch (ext) {
        case ".json": {
            const content = readFileSync(filePath, "utf-8");
            try {
                return JSON.parse(content) as unknown;
            } catch (error) {
                throw new ConfigLoaderError(
                    `Failed to parse JSON configuration`,
                    filePath,
                    error,
                );
            }
        }

        case "":
        case ".mjs":
        case ".ts":
        case ".mts": {
            try {
                // Use dynamic import for JS/TS modules
                const fileUrl = pathToFileURL(filePath).href;
                const module = await import(fileUrl) as { default?: unknown };

                // Support both default export and module.exports style
                return module.default ?? module;
            } catch (error) {
                throw new ConfigLoaderError(
                    `Failed to load module configuration`,
                    filePath,
                    error,
                );
            }
        }

        default:
            throw new ConfigLoaderError(
                `Unsupported configuration file extension: ${ext}`,
                filePath,
            );
    }
}

/**
 * Find configuration file in directory
 */
function findConfigFile(dir: string): string | undefined {
    // Check each default name with each extension
    for (const name of DEFAULT_CONFIG_NAMES) {
        for (const ext of CONFIG_EXTENSIONS) {
            const filePath = resolve(dir, `${name}${ext}`);
            if (existsSync(filePath)) {
                return filePath;
            }
        }
    }

    // Check for package.json with monorepo field
    const packageJsonPath = resolve(dir, "package.json");
    if (existsSync(packageJsonPath)) {
        try {
            const content = readFileSync(packageJsonPath, "utf-8");
            const packageJson = JSON.parse(content) as { monorepo?: unknown };
            if (packageJson.monorepo) {
                return packageJsonPath;
            }
        } catch {
            // Ignore parse errors
        }
    }

    return undefined;
}

/**
 * Resolve configuration file path
 */
function resolveConfigPath(options: LoadConfigOptions): string | undefined {
    const cwd = options.cwd ?? process.cwd();

    if (options.configPath) {
    // Use provided path
        const configPath = isAbsolute(options.configPath)
            ? options.configPath
            : resolve(cwd, options.configPath);

        if (!existsSync(configPath)) {
            throw new ConfigLoaderError(
                `Configuration file not found`,
                configPath,
            );
        }

        return configPath;
    }

    // Search for config file
    let currentDir = cwd;
    const root = resolve("/");

    while (currentDir !== root) {
        const configPath = findConfigFile(currentDir);
        if (configPath) {
            return configPath;
        }

        const parentDir = dirname(currentDir);
        if (parentDir === currentDir) {
            break;
        }
        currentDir = parentDir;
    }

    return undefined;
}

/**
 * Merge configuration objects deeply
 * Note: Uses type assertion because spreading creates compatible but not identical optional property types
 */
function mergeConfigs(
    base: Partial<MonorepoConfig>,
    ...configs: Array<Partial<MonorepoConfig>>
): MonorepoConfig {
    // Start with base config - we know it's at least a Partial<MonorepoConfig>
    let result = { ...base } as Partial<MonorepoConfig>;

    for (const config of configs) {
        result = {
            ...result,
            ...config,
            // Deep merge for nested objects
            ...(result.deps || config.deps ? { deps: { ...result.deps, ...config.deps } } : {}),
            ...(result.tsconfig || config.tsconfig ? { tsconfig: { ...result.tsconfig, ...config.tsconfig } } : {}),
            ...(result.packageJson || config.packageJson ? { packageJson: { ...result.packageJson, ...config.packageJson } } : {}),
            ...(result.circular || config.circular ? { circular: { ...result.circular, ...config.circular } } : {}),
            ...(result.knip || config.knip ? { knip: { ...result.knip, ...config.knip } } : {}),
            ...(result.ci || config.ci ? { ci: { ...result.ci, ...config.ci } } : {}),
            ...(result.output || config.output ? { output: { ...result.output, ...config.output } } : {}),
        } as Partial<MonorepoConfig>;
    }

    return result as MonorepoConfig;
}

/**
 * Process extends property to load parent configurations
 */
async function processExtends(
    config: unknown,
    basePath: string,
): Promise<Partial<MonorepoConfig>> {
    // Use type guard to safely access extends property
    if (!hasExtendsProperty(config)) {
        return config as Partial<MonorepoConfig>;
    }

    const extendsValue = config.extends;

    if (!extendsValue) {
        return config as Partial<MonorepoConfig>;
    }

    const extendsPaths = Array.isArray(extendsValue) ? extendsValue : [extendsValue];
    const parentConfigs: Array<Partial<MonorepoConfig>> = [];

    for (const extendsPath of extendsPaths) {
        const resolvedPath = isAbsolute(extendsPath)
            ? extendsPath
            : resolve(dirname(basePath), extendsPath);

        const parentConfig = await loadConfig({
            configPath: resolvedPath,
            validate: false,
        });

        parentConfigs.push(parentConfig);
    }

    // Remove extends from current config - we know config is an object with extends at this point
    const { extends: _, ...currentConfig } = config;

    // Merge in order: parent configs, then current config
    return mergeConfigs({}, ...parentConfigs, currentConfig as Partial<MonorepoConfig>);
}

/**
 * Load and validate configuration
 */
export async function loadConfig(
    options: LoadConfigOptions = {},
): Promise<MonorepoConfig> {
    const configPath = resolveConfigPath(options);

    if (!configPath) {
        if (options.defaults) {
            return configSchema.parse(options.defaults);
        }
        throw new ConfigLoaderError("No configuration file found");
    }

    // Load raw configuration
    let rawConfig = await loadConfigFile(configPath);

    // Handle package.json special case
    if (configPath.endsWith("package.json")) {
        if (!hasMonorepoField(rawConfig)) {
            throw new ConfigLoaderError(
                "No \"monorepo\" field found in package.json",
                configPath,
            );
        }
        rawConfig = rawConfig.monorepo;
    }

    // Process extends
    const processedConfig = await processExtends(rawConfig, configPath);

    // Merge with defaults
    const mergedConfig = options.defaults
        ? mergeConfigs(options.defaults, processedConfig)
        : processedConfig;

    // Validate if requested
    if (options.validate !== false) {
        try {
            const schema = options.partial ? configSchema.partial() : configSchema;
            return schema.parse(mergedConfig) as MonorepoConfig;
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new ConfigValidationError(error.issues, configPath);
            }
            throw new ConfigLoaderError(
                "Configuration validation failed",
                configPath,
                error,
            );
        }
    }

    return mergedConfig as MonorepoConfig;
}

/**
 * Load configuration synchronously (JSON only)
 */
export function loadConfigSync(
    options: LoadConfigOptions = {},
): MonorepoConfig {
    const configPath = resolveConfigPath(options);

    if (!configPath) {
        if (options.defaults) {
            return configSchema.parse(options.defaults);
        }
        throw new ConfigLoaderError("No configuration file found");
    }

    // Only support JSON for sync loading
    if (!configPath.endsWith(".json")) {
        throw new ConfigLoaderError(
            "Synchronous loading only supports JSON configuration files",
            configPath,
        );
    }

    const content = readFileSync(configPath, "utf-8");
    let rawConfig: unknown;

    try {
        rawConfig = JSON.parse(content) as unknown;
    } catch (error) {
        throw new ConfigLoaderError(
            "Failed to parse JSON configuration",
            configPath,
            error,
        );
    }

    // Handle package.json special case
    if (configPath.endsWith("package.json")) {
        if (!hasMonorepoField(rawConfig)) {
            throw new ConfigLoaderError(
                "No \"monorepo\" field found in package.json",
                configPath,
            );
        }
        rawConfig = rawConfig.monorepo;
    }

    // Note: Cannot process extends in sync mode
    if (hasExtendsProperty(rawConfig) && rawConfig.extends) {
        throw new ConfigLoaderError(
            "Configuration extends is not supported in synchronous mode",
            configPath,
        );
    }

    // Merge with defaults
    const mergedConfig = options.defaults
        ? mergeConfigs(options.defaults, rawConfig as Partial<MonorepoConfig>)
        : (rawConfig as Partial<MonorepoConfig>);

    // Validate if requested
    if (options.validate !== false) {
        try {
            const schema = options.partial ? configSchema.partial() : configSchema;
            return schema.parse(mergedConfig) as MonorepoConfig;
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new ConfigValidationError(error.issues, configPath);
            }
            throw new ConfigLoaderError(
                "Configuration validation failed",
                configPath,
                error,
            );
        }
    }

    return mergedConfig as MonorepoConfig;
}

/**
 * Configuration manager singleton
 */
export class ConfigManager {
    private static instance: ConfigManager;
    private config?: MonorepoConfig;
    private configPath?: string;

    private constructor() {}

    static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    /**
     * Initialize configuration
     */
    async init(options: LoadConfigOptions = {}): Promise<MonorepoConfig> {
        this.config = await loadConfig(options);
        const resolvedPath = resolveConfigPath(options);
        if (resolvedPath !== undefined) {
            this.configPath = resolvedPath;
        }
        return this.config;
    }

    /**
     * Get current configuration
     */
    getConfig(): MonorepoConfig {
        if (!this.config) {
            throw new ConfigLoaderError("Configuration not initialized");
        }
        return this.config;
    }

    /**
     * Get configuration file path
     */
    getConfigPath(): string | undefined {
        return this.configPath;
    }

    /**
     * Update configuration
     */
    updateConfig(updates: Partial<MonorepoConfig>): MonorepoConfig {
        if (!this.config) {
            throw new ConfigLoaderError("Configuration not initialized");
        }
        this.config = mergeConfigs(this.config, updates);
        return this.config;
    }

    /**
     * Reset configuration
     */
    reset(): void {
        this.config = undefined;
        this.configPath = undefined;
    }
}
