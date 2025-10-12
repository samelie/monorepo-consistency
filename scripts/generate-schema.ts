#!/usr/bin/env tsx

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { zodToJsonSchema } from "@adddog/zod-to-json-schema";
import { configSchema } from "../src/config/schema.js";

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

// Write to file
const schemaPath = join(process.cwd(), "monorepo.schema.json");
writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf-8");

console.log("✅ Generated monorepo.schema.json");
