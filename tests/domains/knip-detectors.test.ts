import { describe, expect, it } from "vitest";
// eslint-disable-next-line rad/no-incorrect-pkg-imports
import { augmentWithPlugins } from "../../src/domains/knip/detectors.js";

describe("augmentWithPlugins", () => {
    it("vue-vite + @tailwindcss/vite → ignoreDependencies + vite config + useVueCompiler", () => {
        const files = ["vite.config.ts", "src/main.ts", "src/App.vue"];
        const deps: Record<string, string> = {
            "vue": "^3.4.0",
            "@tailwindcss/vite": "^4.0.0",
            "tailwindcss": "^4.0.0",
            "postcss": "^8.0.0",
        };

        const result = augmentWithPlugins(files, deps, "vue-vite", {
            entry: ["src/main.ts"],
            project: ["src/**/*.{ts,vue}"],
        });

        expect(result.useVueCompiler).toBe(true);
        expect(result.vite).toEqual({ config: ["vite.config.ts"] });
        expect(result.ignoreDependencies).toContain("tailwindcss");
        expect(result.ignoreDependencies).toContain("postcss");
        expect(result.tailwind).toBeUndefined();
    });

    it("vue-vite + @tailwindcss/vite + @tailwindcss/postcss → all three ignored", () => {
        const files = ["vite.config.ts", "src/main.ts"];
        const deps: Record<string, string> = {
            "vue": "^3.4.0",
            "@tailwindcss/vite": "^4.0.0",
            "tailwindcss": "^4.0.0",
            "@tailwindcss/postcss": "^4.0.0",
            "postcss": "^8.0.0",
        };

        const result = augmentWithPlugins(files, deps, "vue-vite", {
            entry: ["src/main.ts"],
            project: ["src/**/*.{ts,vue}"],
        });

        expect(result.ignoreDependencies).toContain("tailwindcss");
        expect(result.ignoreDependencies).toContain("@tailwindcss/postcss");
        expect(result.ignoreDependencies).toContain("postcss");
    });

    it("vite + tailwind.config.ts → tailwind plugin entry, no ignoreDependencies", () => {
        const files = ["vite.config.ts", "tailwind.config.ts", "src/main.tsx"];
        const deps: Record<string, string> = {
            tailwindcss: "^3.4.0",
        };

        const result = augmentWithPlugins(files, deps, "vite", {
            entry: ["src/main.tsx"],
            project: ["src/**/*.{ts,tsx}"],
        });

        expect(result.vite).toEqual({ config: ["vite.config.ts"] });
        expect(result.tailwind).toEqual({ entry: ["tailwind.config.ts"] });
        expect(result.ignoreDependencies).toBeUndefined();
        expect(result.useVueCompiler).toBeUndefined();
    });

    it("vite + postcss.config.js → postcss plugin config", () => {
        const files = ["vite.config.ts", "postcss.config.js", "src/main.ts"];
        const deps: Record<string, string> = {
            postcss: "^8.0.0",
        };

        const result = augmentWithPlugins(files, deps, "vite", {
            entry: ["src/main.ts"],
            project: ["src/**/*.ts"],
        });

        expect(result.postcss).toEqual({ config: ["postcss.config.js"] });
        expect(result.ignoreDependencies).toBeUndefined();
    });

    it("postcss in deps without config or tailwind v4 → ignoreDependencies", () => {
        const files = ["vite.config.ts", "src/main.ts"];
        const deps: Record<string, string> = {
            postcss: "^8.0.0",
        };

        const result = augmentWithPlugins(files, deps, "vite", {
            entry: ["src/main.ts"],
            project: ["src/**/*.ts"],
        });

        expect(result.ignoreDependencies).toContain("postcss");
    });

    it("plain library → no augmentation", () => {
        const files = ["src/index.ts", "src/utils.ts"];
        const deps: Record<string, string> = {
            lodash: "^4.0.0",
        };

        const result = augmentWithPlugins(files, deps, "default", {
            entry: ["src/index.ts"],
            project: ["src/**/*.ts"],
        });

        expect(result.vite).toBeUndefined();
        expect(result.tailwind).toBeUndefined();
        expect(result.postcss).toBeUndefined();
        expect(result.useVueCompiler).toBeUndefined();
        expect(result.ignoreDependencies).toBeUndefined();
    });

    it("preserves existing ignoreBinaries", () => {
        const files = ["vite.config.ts", "src/main.ts"];
        const deps: Record<string, string> = {
            "@tailwindcss/vite": "^4.0.0",
            "tailwindcss": "^4.0.0",
        };

        const result = augmentWithPlugins(files, deps, "vite", {
            entry: ["src/main.ts"],
            project: ["src/**/*.ts"],
            ignoreBinaries: ["pulumi"],
        });

        expect(result.ignoreBinaries).toEqual(["pulumi"]);
        expect(result.ignoreDependencies).toContain("tailwindcss");
    });

    it("non-vue-vite framework → no useVueCompiler", () => {
        const files = ["vite.config.ts", "src/main.tsx"];
        const deps: Record<string, string> = {
            react: "^18.0.0",
        };

        const result = augmentWithPlugins(files, deps, "vite", {
            entry: ["src/main.tsx"],
            project: ["src/**/*.{ts,tsx}"],
        });

        expect(result.useVueCompiler).toBeUndefined();
    });
});
