import isArray from "lodash/isArray";
import mergeWith from "lodash/mergeWith";

// Local type alias to avoid importing the huge knip package at build time
type KnipConfig = Record<string, unknown>;

/**
 * Default Knip configuration with best practices for monorepo setups
 */
export const defaultKnipConfig: KnipConfig = {
    $schema: "https://unpkg.com/knip@6/schema.json",

    treatConfigHintsAsErrors: false,

    // Disable ESLint plugin to avoid "config.flatMap is not a function" error
    eslint: false,

    entry: [],

    project: [],

    paths: {},

    ignore: [],

    ignoreBinaries: [],

    ignoreDependencies: [],

    ignoreMembers: [],
    ignoreUnresolved: [],
    ignoreWorkspaces: [],

    ignoreExportsUsedInFile: false,
    includeEntryExports: false,

    rules: {
        dependencies: "error",
        unlisted: "error",
        files: "error",
        exports: "error",
        types: "error",
        enumMembers: "error",
        nsExports: "off",
        nsTypes: "off",
        duplicates: "error",
        unresolved: "error",
        binaries: "error",
    },

    include: [],
    exclude: [],
    tags: [],

    typescript: {
        config: ["./tsconfig.json"],
    },

    vitest: {
        config: [
            "vitest*.config.{js,mjs,ts,cjs,mts,cts}",
            "vitest.{workspace,projects}.{ts,js,json}",
        ],
        entry: ["**/*.{bench,test,test-d,spec}.?(c|m)[jt]s?(x)"],
    },
};

const arrayMerger = (objValue: unknown, srcValue: unknown) => {
    if (isArray(objValue) && isArray(srcValue)) {
        return [...objValue, ...srcValue];
    }
    return undefined;
};

/**
 * Creates a Knip configuration by deep merging defaults with overrides.
 * Arrays are concatenated instead of replaced.
 *
 * Merge order: internal defaults → schemaDefaults → overrides
 */
export function defineKnipConfig(
    overrides: KnipConfig = {},
    schemaDefaults?: KnipConfig,
): KnipConfig {
    const base = schemaDefaults
        ? mergeWith({}, defaultKnipConfig, schemaDefaults, arrayMerger)
        : defaultKnipConfig;
    return mergeWith({}, base, overrides, arrayMerger);
}
