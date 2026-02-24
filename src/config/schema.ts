import { isAbsolute, resolve } from "node:path";
import process from "node:process";
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
 * Reusable tsconfig content shape (compilerOptions, include, exclude, watchOptions)
 */
const tsconfigContentSchema = z.object({
    compilerOptions: z.record(z.string(), z.unknown()).optional().describe("TypeScript compiler options overrides"),
    include: z.array(z.string()).optional().describe("Include patterns"),
    exclude: z.array(z.string()).optional().describe("Exclude patterns"),
    watchOptions: z.record(z.string(), z.unknown()).optional().describe("Watch mode options"),
});

/**
 * TypeScript configuration management
 */
const tsconfigConfigSchema = z.object({
    enabled: z.boolean().default(true).describe("Enable TypeScript config generation"),
    generate: z.array(z.enum(["web", "node", "builder"]))
        .default(["web", "node", "builder"])
        .describe("Config types to generate"),
    /** @deprecated Use `generate` instead */
    types: z.array(z.enum(["web", "node", "builder"]))
        .optional()
        .describe("DEPRECATED: Use `generate` instead"),
    generateTypecheck: z.boolean().default(true).describe("Generate tsconfig.typecheck.json files"),
    excludePatterns: z.array(z.string())
        .default(["**/node_modules/**", "**/dist/**", "**/build/**"])
        .describe("Patterns to exclude when scanning for packages"),

    // Consumer overrides — merged into generated tsconfigs
    base: tsconfigContentSchema.optional().describe("Overrides applied to ALL generated tsconfigs"),
    web: tsconfigContentSchema.optional().describe("Overrides for web tsconfigs"),
    node: tsconfigContentSchema.optional().describe("Overrides for node tsconfigs"),
    builder: tsconfigContentSchema.optional().describe("Overrides for builder tsconfigs"),
    typecheck: z.object({
        compilerOptions: z.record(z.string(), z.unknown()).optional().describe("Typecheck compiler options overrides"),
    }).optional().describe("Overrides for tsconfig.typecheck.json"),

    // Validation options (used by validate/check commands)
    validation: z.object({
        checkMissing: z.boolean().default(true).describe("Check for missing tsconfig.json files"),
        checkExtends: z.boolean().default(true).describe("Validate extends chains"),
        checkConsistency: z.boolean().default(true).describe("Check compiler options consistency"),
        strictMode: z.boolean().default(false).describe("Enforce strict validation rules"),
    }).optional().describe("Validation options"),

    /** @deprecated Ignored — internal defaults used instead */
    configLocations: z.array(z.string()).optional().describe("DEPRECATED: Ignored, internal defaults used"),
    /** @deprecated Ignored — internal defaults used instead */
    rootConfigDir: z.string().optional().describe("DEPRECATED: Ignored, internal defaults used"),
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
 * Knip configuration
 */
const knipConfigSchema = z.object({
    enabled: z.boolean().default(true).describe("Enable knip config generation"),
    frameworkDetection: z.boolean().default(true).describe("Auto-detect framework for knip config"),
    addScriptToPackageJson: z.boolean().default(true).describe("Add knip script to package.json"),
    defaults: z.record(z.string(), z.unknown()).optional().describe("Base knip overrides applied to ALL packages"),
    packages: z.record(z.string(), z.record(z.string(), z.unknown())).optional().describe("Per-package knip overrides keyed by package name"),
});

/**
 * Circular dependency detection configuration
 */
const circularConfigSchema = z.object({
    enabled: z.boolean().default(true).describe("Enable circular dependency detection"),
    intraPackage: z.boolean().default(true).describe("Scan for module-level circular imports within packages"),
    interPackage: z.boolean().default(true).describe("Scan for workspace:* dependency cycles between packages"),
    intraPackageSeverity: z.enum(["low", "medium", "high", "critical"]).default("high").describe("Severity for intra-package circular imports"),
    interPackageSeverity: z.enum(["low", "medium", "high", "critical"]).default("critical").describe("Severity for inter-package circular dependencies"),
    tools: z.array(z.enum(["dpdm", "madge"])).default(["dpdm", "madge"]).describe("Tools to use for intra-package detection"),
    ignoreCycles: z.array(z.object({
        pattern: z.string().describe("File path glob pattern to ignore"),
        package: z.string().optional().describe("Package name glob to scope the ignore rule"),
        reason: z.string().optional().describe("Reason for ignoring this cycle"),
    })).default([]).describe("Known intra-package cycles to ignore"),
    ignorePackageCycles: z.array(
        z.array(z.string()).min(2),
    ).default([]).describe("Known inter-package cycles to ignore (arrays of package names)"),
    dpdm: z.object({
        skipDynamicImports: z.boolean().default(true).describe("Skip dynamic import() expressions"),
        skipTypeOnly: z.boolean().default(true).describe("Skip type-only imports"),
        tsconfig: z.string().optional().describe("Path to tsconfig for dpdm"),
    }).optional().describe("dpdm tool options"),
    madge: z.object({
        tsconfig: z.string().optional().describe("Path to tsconfig for madge"),
        fileExtensions: z.array(z.string()).default(["ts", "tsx", "js", "jsx"]).describe("File extensions to scan"),
    }).optional().describe("madge tool options"),
    includePackages: z.array(z.string()).default([]).describe("Only scan these packages (glob patterns)"),
    excludePackages: z.array(z.string()).default([]).describe("Exclude these packages from scanning (glob patterns)"),
});

/**
 * Build configuration
 */
const buildConfigSchema = z.object({
    orderedPackages: z.array(z.string()).default([]).describe("Packages to build in order"),
});

/**
 * Publish configuration
 */
const publishConfigSchema = z.object({
    githubUsername: z.string().optional().describe("GitHub username for public repos"),
    syncConfigPath: z.string().default(".github/sync-config.yaml").describe("Path to sync config"),
});

/**
 * Main configuration schema
 */
export const configSchema = z.object({
    $schema: z.string().optional().describe("JSON Schema reference"),
    version: z.literal("1.0.0").default("1.0.0").describe("Config schema version"),

    // Domain configurations
    build: buildConfigSchema.optional().describe("Build configuration"),
    circular: circularConfigSchema.optional().describe("Circular dependency detection configuration"),
    deps: depsConfigSchema.optional().describe("Dependency management configuration"),
    knip: knipConfigSchema.optional().describe("Knip dead-code analysis configuration"),
    packageJson: packageJsonConfigSchema.optional().describe("Package.json hygiene configuration"),
    publish: publishConfigSchema.optional().describe("Publish configuration"),
    tsconfig: tsconfigConfigSchema.optional().describe("TypeScript configuration management"),

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

// Inferred types
export type MonorepoConfig = z.infer<typeof configSchema>;
export type TazeConfig = z.infer<typeof tazeConfigSchema>;
export type DepsConfig = z.infer<typeof depsConfigSchema>;
export type PackageJsonConfig = z.infer<typeof packageJsonConfigSchema>;
export type TsconfigConfig = z.infer<typeof tsconfigConfigSchema>;
export type TsconfigContentConfig = z.infer<typeof tsconfigContentSchema>;
export type CircularConfig = z.infer<typeof circularConfigSchema>;
export type KnipSchemaConfig = z.infer<typeof knipConfigSchema>;
