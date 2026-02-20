import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fg from "fast-glob";

interface WorkspaceConfig {
    entry?: string[];
    project?: string[];
    ignore?: string[];
    ignoreBinaries?: string[];
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
            return { name: detector.name, config: detector.config };
        }
    }

    return { name: "default", config: DEFAULT_CONFIG };
}
