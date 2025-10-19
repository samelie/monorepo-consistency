import config from "@adddog/config-defaults/knip.config.js";

export default defineKnipConfig({
    entry: ["src/index.ts", "src/**/__tests__/**/*.test.ts"],
    project: ["src/**/*.ts"]
});
