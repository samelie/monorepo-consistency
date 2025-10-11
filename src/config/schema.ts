import { isAbsolute, resolve } from "node:path";
import { z } from "zod/v4";

/**
 * Path schema that supports both relative and absolute paths
 */
const pathSchema = z.string().transform((path, ctx) => {
    try {
    // Convert relative paths to absolute
        const resolvedPath = isAbsolute(path) ? path : resolve(process.cwd(), path);
        return resolvedPath;
    } catch (error) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid path: ${String(error)}`,
        });
        return z.NEVER;
    }
});

/**
 * Command runner options
 */
const commandRunnerSchema = z.enum(["npx", "pnpx", "yarn", "bunx"])
    .default("npx")
    .describe("Command runner to use for executing tools");

/**
 * Taze configuration schema
 * @see https://github.com/antfu-collective/taze
 */
const tazeConfigSchema = z.object({
    runner: commandRunnerSchema.describe("Command runner for taze"),
    configPath: pathSchema.optional().describe("Path to taze configuration file"),
});

/**
 * Dependency management configuration
 */
const depsConfigSchema = z.object({
    taze: tazeConfigSchema.optional().describe("Taze dependency updater configuration"),
    checkUnused: z.boolean().default(true).describe("Check for unused dependencies"),
    checkMissing: z.boolean().default(true).describe("Check for missing dependencies"),
    checkVersionMismatch: z.boolean().default(true).describe("Check for version mismatches"),
    ignoredPackages: z.array(z.string()).default([]).describe("Packages to ignore in checks"),
    versionGroups: z.array(
        z.object({
            packages: z.array(z.string()).describe("Package patterns to group"),
            dependencies: z.array(z.string()).describe("Dependencies that must match versions"),
            policy: z.enum(["exact", "semver"]).default("semver").describe("Version matching policy"),
        }),
    ).optional().describe("Groups of packages that must have matching dependency versions"),
});

/**
 * TypeScript configuration management
 */
const tsconfigConfigSchema = z.object({
    enabled: z.boolean().default(true).describe("Enable TypeScript config generation"),
    types: z.array(z.enum(["web", "node", "builder"]))
        .default(["web", "node", "builder"])
        .describe("Config types to generate"),
    configLocations: z.array(z.string())
        .default([
            "../config",
            "../../config",
            "../packages/config",
            "../../packages/config",
            "../../../packages/config",
            "../../../../packages/config",
        ])
        .describe("Possible locations for app-specific configs relative to a package"),
    generateTypecheck: z.boolean().default(true).describe("Generate tsconfig.typecheck.json files"),
    filterPathsByDependencies: z.boolean()
        .default(true)
        .describe("Filter compilerOptions.paths to only include actual dependencies"),
    excludePatterns: z.array(z.string())
        .default(["**/node_modules/**", "**/dist/**", "**/build/**"])
        .describe("Patterns to exclude when scanning for packages"),
    rootConfigDir: z.string()
        .default("packages/config")
        .describe("Root config directory to skip during generation"),
    validation: z.object({
        checkMissing: z.boolean().default(true).describe("Check for missing tsconfig.json files"),
        checkExtends: z.boolean().default(true).describe("Validate extends chains"),
        checkConsistency: z.boolean().default(true).describe("Check compiler options consistency"),
        strictMode: z.boolean().default(false).describe("Enforce strict validation rules"),
    }).optional().describe("Validation options"),
});

/**
 * Code quality configuration
 */
const qualityConfigSchema = z.object({
    linting: z.object({
        enabled: z.boolean().default(true).describe("Enable linting checks"),
        fix: z.boolean().default(false).describe("Auto-fix linting issues"),
        configPath: pathSchema.optional().describe("Path to ESLint config"),
    }).optional(),
    typeChecking: z.object({
        enabled: z.boolean().default(true).describe("Enable type checking"),
        strict: z.boolean().default(true).describe("Use strict TypeScript settings"),
        configPath: pathSchema.optional().describe("Path to TypeScript config"),
    }).optional(),
    testing: z.object({
        enabled: z.boolean().default(true).describe("Enable test running"),
        coverage: z.boolean().default(false).describe("Collect coverage"),
        minCoverage: z.number().min(0).max(100).default(80).describe("Minimum coverage percentage"),
    }).optional(),
});

/**
 * Workspace configuration
 */
const workspaceConfigSchema = z.object({
    packageManager: z.enum(["pnpm", "npm", "yarn"]).default("pnpm").describe("Package manager"),
    rootPath: pathSchema.optional().describe("Monorepo root path"),
    workspacePatterns: z.array(z.string())
        .default(["packages/*", "apps/*"])
        .describe("Workspace package patterns"),
    ignoredWorkspaces: z.array(z.string()).default([]).describe("Workspaces to ignore"),
});

/**
 * Package catalog configuration
 */
const catalogConfigSchema = z.object({
    enabled: z.boolean().default(false).describe("Enable package cataloging"),
    categories: z.array(
        z.object({
            name: z.string().describe("Category name"),
            pattern: z.string().describe("Pattern to match packages"),
            description: z.string().optional().describe("Category description"),
        }),
    ).default([]).describe("Package categories"),
    generateDocs: z.boolean().default(false).describe("Generate catalog documentation"),
    outputPath: pathSchema.optional().describe("Path to output catalog"),
});

/**
 * Health check configuration
 */
const healthConfigSchema = z.object({
    checks: z.array(z.enum([
        "dependencies",
        "quality",
        "build",
        "tests",
        "documentation",
    ])).default(["dependencies", "quality"]).describe("Health checks to run"),
    failFast: z.boolean().default(false).describe("Stop on first failure"),
    reportFormat: z.enum(["json", "html", "markdown"]).default("markdown").describe("Report format"),
    outputPath: pathSchema.optional().describe("Path to save health report"),
});

/**
 * Package.json hygiene configuration
 */
const packageJsonConfigSchema = z.object({
    enabled: z.boolean().default(true).describe("Enable package.json hygiene checks"),

    // Script management
    scripts: z.object({
        enforce: z.boolean().default(false).describe("Enforce script presence across packages"),
        required: z.record(z.string(), z.string())
            .default({})
            .describe("Scripts that must exist in all packages (name -> command)"),
        recommended: z.record(z.string(), z.string())
            .default({})
            .describe("Scripts that should exist (warns if missing)"),
        forbidden: z.array(z.string())
            .default([])
            .describe("Script names that should not exist"),
        ignorePackages: z.array(z.string())
            .default([])
            .describe("Package names/patterns to exclude from script checks"),
    }).optional().describe("Script consistency configuration"),

    // Field validation
    fields: z.object({
        required: z.array(
            z.union([
                z.string(),
                z.object({
                    field: z.string().describe("Field name"),
                    default: z.unknown().describe("Default value to use when auto-fixing"),
                }),
            ]),
        )
            .default(["name", "version"])
            .describe("Required fields in package.json (string or object with default)"),
        forbidden: z.array(z.string())
            .default([])
            .describe("Fields that should not exist"),
        validate: z.record(z.string(), z.object({
            pattern: z.string().optional().describe("Regex pattern to match"),
            validator: z.string().optional().describe("Custom validation function"),
        })).optional().describe("Custom field validators"),
    }).optional().describe("Package.json field validation"),

    // Consistency checks
    consistency: z.object({
        checkLicense: z.boolean().default(true).describe("Ensure consistent license"),
        checkEngines: z.boolean().default(true).describe("Check Node.js engine versions"),
        checkRepository: z.boolean().default(false).describe("Validate repository field"),
        checkAuthor: z.boolean().default(false).describe("Validate author field"),
    }).optional().describe("Consistency check options"),

    // Auto-fix options
    autoFix: z.object({
        addMissingScripts: z.boolean().default(false).describe("Add missing required scripts"),
        removeInvalidFields: z.boolean().default(false).describe("Remove forbidden fields"),
    }).optional().describe("Auto-fix configuration"),
});

/**
 * Main configuration schema
 */
export const configSchema = z.object({
    $schema: z.string().optional().describe("JSON Schema reference"),
    version: z.literal("1.0.0").default("1.0.0").describe("Config schema version"),

    // Domain configurations
    deps: depsConfigSchema.optional().describe("Dependency management configuration"),
    tsconfig: tsconfigConfigSchema.optional().describe("TypeScript configuration management"),
    quality: qualityConfigSchema.optional().describe("Code quality configuration"),
    workspace: workspaceConfigSchema.optional().describe("Workspace configuration"),
    catalog: catalogConfigSchema.optional().describe("Package catalog configuration"),
    health: healthConfigSchema.optional().describe("Health check configuration"),
    packageJson: packageJsonConfigSchema.optional().describe("Package.json hygiene configuration"),

    // Global settings
    ci: z.object({
        enabled: z.boolean().default(false).describe("CI mode"),
        failOnWarning: z.boolean().default(false).describe("Treat warnings as errors in CI"),
    }).optional().describe("CI-specific settings"),

    output: z.object({
        format: z.enum(["pretty", "json", "compact"]).default("pretty").describe("Output format"),
        verbose: z.boolean().default(false).describe("Verbose output"),
        silent: z.boolean().default(false).describe("Suppress output"),
    }).optional().describe("Output configuration"),

    // Extension points
    plugins: z.array(
        z.object({
            name: z.string().describe("Plugin name"),
            config: z.record(z.string(), z.unknown()).optional().describe("Plugin-specific configuration"),
        }),
    ).optional().describe("Plugins to load"),

    extends: z.union([z.string(), z.array(z.string())])
        .optional()
        .describe("Config files to extend from"),
});

// Export inferred types
export type MonorepoConfig = z.infer<typeof configSchema>;
export type DepsConfig = z.infer<typeof depsConfigSchema>;
export type QualityConfig = z.infer<typeof qualityConfigSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type CatalogConfig = z.infer<typeof catalogConfigSchema>;
export type HealthConfig = z.infer<typeof healthConfigSchema>;
