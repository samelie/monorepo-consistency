import { defineKnipConfig } from "@adddog/config-defaults/knip.config.js";

export default defineKnipConfig({
    entry: ["src/index.ts", "src/cli.ts", "tests/**/*.test.ts"],
    project: ["src/**/*.ts", "tests/**/*.ts"],
    ignore: ["tests/fixtures/**", "tests/helpers/**"],
});
