import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["tests/**/*.test.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.d.ts",
                "src/cli.ts",
                "src/commands/**",
                "src/types/**",
                "src/index.ts",
            ],
        },
        testTimeout: 10000,
        hookTimeout: 10000,
    },
});
