import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { configSchema } from "./schema.js";

/**
 * Generate JSON Schema from Zod schema
 */
export function generateJsonSchema() {
    const jsonSchema = zodToJsonSchema(configSchema, {
        name: "MonorepoConfig",
        $refStrategy: "relative",
        basePath: ["#/definitions"],
        target: "jsonSchema7",
        definitions: {
            // Additional definitions can be added here if needed
        },
    });

    // Add meta information
    const schema = {
        $schema: "http://json-schema.org/draft-07/schema#",
        $id: "https://github.com/rad/mono/schemas/monorepo-config.json",
        title: "Monorepo Configuration Schema",
        description: "Configuration schema for monorepo-consistency tool",
        ...jsonSchema,
    };

    return schema;
}

/**
 * Write JSON Schema to file
 */
export function writeJsonSchemaToFile(outputPath?: string): string {
    const schema = generateJsonSchema();
    const filePath = outputPath ?? resolve(process.cwd(), "monorepo.schema.json");

    writeFileSync(filePath, JSON.stringify(schema, null, 2), "utf-8");

    return filePath;
}

/**
 * Generate TypeScript definitions from schema
 */
export function generateTypeScriptDefinitions(): string {
    return `/**
 * Auto-generated TypeScript definitions for Monorepo Configuration
 * Do not edit manually - this file is generated from the Zod schema
 */

import type { MonorepoConfig } from '@adddog/monorepo-consistency';

declare module 'monorepo.config' {
  const config: MonorepoConfig;
  export default config;
}

declare module '*.monoreporc.json' {
  const config: MonorepoConfig;
  export default config;
}
`;
}

/**
 * Create configuration template
 */
export function createConfigTemplate(): object {
    return {
        $schema: "./monorepo.schema.json",
        version: "1.0.0",
        deps: {
            taze: {
                runner: "npx",
                configPath: "./taze.config.json",
            },
            checkUnused: true,
            checkMissing: true,
            checkVersionMismatch: true,
            ignoredPackages: [],
            versionGroups: [
                {
                    packages: ["packages/*"],
                    dependencies: ["typescript", "vitest", "eslint"],
                    policy: "exact",
                },
            ],
        },
        tsconfig: {
            enabled: true,
            types: ["web", "node", "builder"],
            configLocations: [
                "../config",
                "../../config",
                "../packages/config",
                "../../packages/config",
                "../../../packages/config",
                "../../../../packages/config",
            ],
            generateTypecheck: true,
            filterPathsByDependencies: true,
            excludePatterns: [
                "**/node_modules/**",
                "**/dist/**",
                "**/build/**",
            ],
            rootConfigDir: "packages/config",
            validation: {
                checkMissing: true,
                checkExtends: true,
                checkConsistency: true,
                strictMode: false,
            },
        },
        packageJson: {
            enabled: true,
            scripts: {
                enforce: true,
                required: {},
                recommended: {
                    "build": "unbuild",
                    "lint": "eslint .",
                    "lint:fix": "eslint --fix .",
                    "types": "tsc -p tsconfig.typecheck.json",
                    "test": "vitest run",
                },
                forbidden: ["prepublish", "prepublishOnly"],
                ignorePackages: [],
            },
            fields: {
                required: [
                    "name",
                    { field: "version", default: "0.0.1" },
                    { field: "type", default: "module" },
                    {
                        field: "engines",
                        default: {
                            node: ">= 22",
                            pnpm: ">= 10",
                            npm: ">= 11",
                        },
                    },
                    { field: "private", default: true },
                ],
                forbidden: ["postinstall"],
            },
            consistency: {
                checkLicense: true,
                checkEngines: true,
                checkRepository: false,
                checkAuthor: false,
            },
            autoFix: {
                addMissingScripts: false,
                removeInvalidFields: false,
            },
        },
        quality: {
            linting: {
                enabled: true,
                fix: false,
            },
            typeChecking: {
                enabled: true,
                strict: true,
            },
            testing: {
                enabled: true,
                coverage: false,
                minCoverage: 80,
            },
        },
        workspace: {
            packageManager: "pnpm",
            workspacePatterns: ["packages/*", "apps/*"],
            ignoredWorkspaces: [],
        },
        catalog: {
            enabled: false,
            categories: [],
            generateDocs: false,
        },
        health: {
            checks: ["dependencies", "quality"],
            failFast: false,
            reportFormat: "markdown",
        },
        ci: {
            enabled: false,
            failOnWarning: false,
        },
        output: {
            format: "pretty",
            verbose: false,
            silent: false,
        },
    };
}

/**
 * Validate configuration against schema
 */
export function validateConfig(config: unknown): {
    valid: boolean;
    errors?: Array<{ path: string; message: string }>;
} {
    try {
        configSchema.parse(config);
        return { valid: true };
    } catch (error) {
        if (error instanceof Error && "issues" in error) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const zodError = error as any;
            const errors = zodError.issues.map((issue: any) => ({
                path: issue.path.join("."),
                message: issue.message,
            }));
            return { valid: false, errors };
        }
        return {
            valid: false,
            errors: [{ path: "", message: String(error) }],
        };
    }
}
