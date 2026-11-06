import type { KnipConfig } from "knip";

export default {
    $schema: "https://unpkg.com/knip@6/schema.json",
    treatConfigHintsAsErrors: false,
    eslint: false,
    project: ["src/**/*.ts"],
    ignoreDependencies: [
        "@adddog/zod-to-json-schema",
    ],
    ignoreBinaries: [
        // clipboard commands belong to host platforms rather than npm dependencies
        "clip",
        "gh",
        "pbcopy",
        "xclip",
    ],
} satisfies KnipConfig;
