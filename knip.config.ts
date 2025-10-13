import config from "@adddog/config-defaults/knip.config.js";

export default {
    ...config,
    entry: ["src/index.ts", "src/**/__tests__/**/*.test.ts"],
    project: ["src/**/*.ts"],
    paths: {
    },
    ignoreDependencies: [
        ...(config.ignoreDependencies || []),
    ],
    typescript: {
        config: ["./tsconfig.json"],
    },
};
