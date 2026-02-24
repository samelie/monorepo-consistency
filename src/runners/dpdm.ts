import fg from "fast-glob";

export interface DpdmOptions {
    skipDynamicImports?: boolean;
    skipTypeOnly?: boolean;
    tsconfig?: string;
}

export interface DpdmResult {
    circular: string[][];
}

/**
 * Run dpdm programmatic API against a package's source directory.
 * Uses dynamic import so the tool degrades gracefully if dpdm isn't installed.
 */
export async function runDpdm(packagePath: string, options: DpdmOptions = {}): Promise<DpdmResult> {
    let dpdm: typeof import("dpdm");
    try {
        dpdm = await import("dpdm");
    } catch {
        throw new Error(
            "dpdm is not installed. Run: pnpm add -D dpdm",
        );
    }

    const entries = await fg(["src/**/*.{ts,tsx,js,jsx}"], {
        cwd: packagePath,
        absolute: true,
        ignore: ["**/*.d.ts", "**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
    });

    if (entries.length === 0) {
        return { circular: [] };
    }

    const allCircular: string[][] = [];

    for (const entry of entries) {
        const tree = await dpdm.parseDependencyTree(entry, {
            skipDynamicImports: options.skipDynamicImports ?? true,
            transform: (options.skipTypeOnly ?? true) as boolean,
            context: packagePath,
            extensions: [".ts", ".tsx", ".js", ".jsx"],
            tsconfig: options.tsconfig,
        });

        const circulars = dpdm.parseCircular(tree);
        for (const cycle of circulars) {
            allCircular.push(cycle);
        }
    }

    return { circular: allCircular };
}
