#!/usr/bin/env tsx

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { configSchema } from '../src/config/schema.js';

const jsonSchema = zodToJsonSchema(configSchema, {
  name: 'MonorepoConfig',
  $refStrategy: 'none',
});

// Add custom properties
const schema = {
  ...jsonSchema,
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: './monorepo.schema.json',
  title: 'Monorepo Configuration Schema',
  description: 'Configuration schema for monorepo-consistency tool',
};

// Write to file
const schemaPath = join(process.cwd(), 'monorepo.schema.json');
writeFileSync(schemaPath, JSON.stringify(schema, null, 2) + '\n', 'utf-8');

console.log('✅ Generated monorepo.schema.json');
