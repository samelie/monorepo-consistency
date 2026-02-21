import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fg from "fast-glob";

export interface WorkspaceConfig {
    entry?: string[];
    project?: string[];
    ignore?: string[];
    ignoreBinaries?: string[];
    ignoreDependencies?: string[];
    // Plugin configs
    vite?: boolean | { config?: string[]; entry?: string[] };
    tailwind?: boolean | { config?: string[]; entry?: string[] };
    postcss?: boolean | { config?: string[]; entry?: string[] };
    // Vue SFC compiler flag (template uses this to generate compiler code)
    useVueCompiler?: boolean;
}

interface FrameworkDetector {
    name: string;
    detect: (files: string[], pkgDeps: Record<string, string>) => boolean;
    config: WorkspaceConfig;
}

const DEFAULT_CONFIG: WorkspaceConfig = {
    entry: ["src/index.ts"],
    project: ["src/**/*.ts"],
};

const FRAMEWORK_DETECTORS: FrameworkDetector[] = [
    {
        name: "next",
        detect: (files, deps) =>
            files.some(f => f.match(/next\.config\.(js|mjs|ts)$/)) ||
            "next" in deps,
        config: {
            entry: ["src/index.ts", "app/**/*.{ts,tsx}", "pages/**/*.{ts,tsx}"],
            project: ["**/*.{ts,tsx}"],
        },
    },
    {
        name: "vue-vite",
        detect: (files, deps) =>
            files.some(f => f.match(/vite\.config\.(js|ts)$/)) && "vue" in deps,
        config: {
            entry: ["src/main.ts", "src/index.ts"],
            project: ["src/**/*.{ts,vue}"],
        },
    },
    {
        name: "vite",
        detect: files => files.some(f => f.match(/vite\.config\.(js|ts)$/)),
        config: {
            entry: ["src/main.ts", "src/main.tsx", "src/index.ts", "src/index.tsx"],
            project: ["src/**/*.{ts,tsx}"],
        },
    },
    {
        name: "cli",
        detect: (files, deps) =>
            files.some(f => f.includes("bin/")) ||
            files.some(f => f.match(/cli\.(ts|js)$/)) ||
            "commander" in deps ||
            "yargs" in deps,
        config: {
            entry: ["src/index.ts", "src/cli.ts", "bin/*.{ts,js}"],
            project: ["src/**/*.ts", "bin/**/*.{ts,js}"],
        },
    },
    {
        name: "pulumi",
        detect: (_, deps) => "@pulumi/pulumi" in deps,
        config: {
            entry: ["src/index.ts", "index.ts"],
            project: ["**/*.ts"],
            ignoreBinaries: ["pulumi"],
        },
    },
    {
        name: "worker",
        detect: files =>
            files.some(f => f.match(/\.worker\.(ts|js)$/)) ||
            files.some(f => f.includes("workers/")),
        config: {
            entry: ["src/index.ts", "src/**/*.worker.ts"],
            project: ["src/**/*.ts"],
        },
    },
];

/**
 * Augment a workspace config with knip plugin configs and ignoreDependencies
 * based on detected files and dependencies.
 */
export function augmentWithPlugins(
    files: string[],
    deps: Record<string, string>,
    frameworkName: string,
    config: WorkspaceConfig,
): WorkspaceConfig {
    const result = { ...config };
    const ignoreDeps: string[] = [];

    // Vite config detection
    const viteConfig = files.find(f => /^vite\.config\.(?:js|ts|mjs|mts)$/.test(f));
    if (viteConfig) {
        result.vite = { config: [viteConfig] };
    }

    // Tailwind v3: config file exists → let knip's tailwind plugin handle it
    const tailwindConfig = files.find(f => /^tailwind\.config\.(?:js|ts|cjs|mjs)$/.test(f));
    if (tailwindConfig) {
        result.tailwind = { entry: [tailwindConfig] };
    }

    // Tailwind v4: @tailwindcss/vite in deps but no tailwind config file
    const hasTailwindVite = "@tailwindcss/vite" in deps;
    if (hasTailwindVite && !tailwindConfig) {
        if ("tailwindcss" in deps) ignoreDeps.push("tailwindcss");
        if ("@tailwindcss/postcss" in deps) ignoreDeps.push("@tailwindcss/postcss");
        // postcss without its own config → undiscoverable
        const postcssConfig = files.find(f => /^postcss\.config\.(?:js|ts|cjs|mjs)$/.test(f));
        if ("postcss" in deps && !postcssConfig) ignoreDeps.push("postcss");
    }

    // PostCSS config detection
    const postcssConfig = files.find(f => /^postcss\.config\.(?:js|ts|cjs|mjs)$/.test(f));
    if (postcssConfig) {
        result.postcss = { config: [postcssConfig] };
    } else if ("postcss" in deps && !hasTailwindVite) {
        // postcss in deps, no config file, not handled by tailwind v4 path
        ignoreDeps.push("postcss");
    }

    // Vue compiler
    if (frameworkName === "vue-vite") {
        result.useVueCompiler = true;
    }

    if (ignoreDeps.length > 0) {
        result.ignoreDependencies = [...(result.ignoreDependencies ?? []), ...ignoreDeps];
    }

    return result;
}

/**
 * Detect framework used in a package directory and return knip config overrides
 */
export async function detectFramework(
    pkgPath: string,
): Promise<{ name: string; config: WorkspaceConfig }> {
    const files = await fg(["**/*"], {
        cwd: pkgPath,
        deep: 2,
        onlyFiles: true,
        ignore: ["**/node_modules/**", "**/dist/**"],
    });

    let deps: Record<string, string> = {};
    try {
        const pkgContent = await readFile(join(pkgPath, "package.json"), "utf-8");
        const pkg = JSON.parse(pkgContent);
        deps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {
        // No package.json or parse error
    }

    for (const detector of FRAMEWORK_DETECTORS) {
        if (detector.detect(files, deps)) {
            const augmented = augmentWithPlugins(files, deps, detector.name, detector.config);
            return { name: detector.name, config: augmented };
        }
    }

    const augmented = augmentWithPlugins(files, deps, "default", DEFAULT_CONFIG);
    return { name: "default", config: augmented };
}
