#!/usr/bin/env tsx

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { zodToJsonSchema } from "@adddog/zod-to-json-schema";
import { configSchema } from "../src/config/schema.js";

// Walk up to find monorepo root (has pnpm-workspace.yaml)
function findMonorepoRoot(startDir: string): string {
    let dir = startDir;
    while (dir !== dirname(dir)) {
        if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
        dir = dirname(dir);
    }
    return startDir; // fallback to cwd
}

// Convert Zod schema to JSON Schema using @adddog/zod-to-json-schema
const jsonSchema = zodToJsonSchema(configSchema, {
    name: "Monorepo Configuration",
    $schemaUrl: true,
    $refStrategy: "none",
    target: "jsonSchema7",
});

// Add custom metadata
const schema = {
    ...jsonSchema,
    $id: "./monorepo.schema.json",
    description: "Configuration schema for monorepo-consistency tool",
};

// Write to monorepo root
const root = findMonorepoRoot(resolve(process.cwd()));
const schemaPath = join(root, "monorepo.schema.json");
writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf-8");

console.log(`Generated monorepo.schema.json at ${schemaPath}`);
