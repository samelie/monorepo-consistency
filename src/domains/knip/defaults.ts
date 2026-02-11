import { isArray, mergeWith } from "lodash";

// Local type alias to avoid importing the huge knip package at build time
type KnipConfig = Record<string, unknown>;

/**
 * Default Knip configuration with best practices for monorepo setups
 */
export const defaultKnipConfig: KnipConfig = {
    $schema: "https://unpkg.com/knip@5/schema.json",

    treatConfigHintsAsErrors: false,

    // Disable ESLint plugin to avoid "config.flatMap is not a function" error
    eslint: false,

    entry: [
        "knip.config.ts",
    ],

    project: [
        "knip.config.ts",
        "eslint.config.mjs",
    ],

    paths: {},

    ignore: [
        "**/knip.config.ts",
        "**/eslint.config.mjs",
        "**.eslintrc*",
        "**/.storybook/**",
        "**/*.stories.*",
        "**/dev-dist/**",
        "**/mocks/handlers.ts",
        "**/tailwind.config.ts",
        "**/vite-env.d.ts",
        "**/examples/**",
        "**/dist/**",
    ],

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
        classMembers: "off",
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

    workspaces: {},
};

/**
 * Creates a Knip configuration by deep merging defaults with overrides.
 * Arrays are concatenated instead of replaced.
 */
export function defineKnipConfig(overrides: KnipConfig = {}): KnipConfig {
    return mergeWith({}, defaultKnipConfig, overrides, (objValue, srcValue) => {
        if (isArray(objValue) && isArray(srcValue)) {
            return objValue.concat(srcValue);
        }
        return undefined;
    });
}
