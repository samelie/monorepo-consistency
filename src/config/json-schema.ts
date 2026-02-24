import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { zodToJsonSchema } from "@adddog/zod-to-json-schema";
import { ZodError } from "zod/v4";
import { configSchema } from "./schema";

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
            generate: ["web", "node", "builder"],
            generateTypecheck: true,
            excludePatterns: [
                "**/node_modules/**",
                "**/dist/**",
                "**/build/**",
            ],
            base: {},
            web: {},
            node: {},
            builder: {},
            typecheck: {},
            validation: {
                checkMissing: true,
                checkExtends: true,
                checkConsistency: true,
                strictMode: false,
            },
        },
        knip: {
            enabled: true,
            frameworkDetection: true,
            addScriptToPackageJson: true,
            defaults: {},
            packages: {},
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
        circular: {
            enabled: true,
            intraPackage: true,
            interPackage: true,
            intraPackageSeverity: "high",
            interPackageSeverity: "critical",
            tools: ["dpdm", "madge"],
            ignoreCycles: [],
            ignorePackageCycles: [],
            includePackages: [],
            excludePackages: [],
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
        if (error instanceof ZodError) {
            const errors = error.issues.map(issue => ({
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
