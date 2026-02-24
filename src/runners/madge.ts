export interface MadgeOptions {
    tsconfig?: string;
    fileExtensions?: string[];
}

export interface MadgeResult {
    circular: string[][];
}

/**
 * Run madge programmatic API against a package's source directory.
 * Uses dynamic import so the tool degrades gracefully if madge isn't installed.
 */
export async function runMadge(packagePath: string, options: MadgeOptions = {}): Promise<MadgeResult> {
    let madge: typeof import("madge");
    try {
        madge = await import("madge");
    } catch {
        throw new Error(
            "madge is not installed. Run: pnpm add -D madge",
        );
    }

    const madgeFn = madge.default;

    const result = await madgeFn(`${packagePath}/src`, {
        fileExtensions: options.fileExtensions ?? ["ts", "tsx", "js", "jsx"],
        tsConfig: options.tsconfig,
        excludeRegExp: [/\.d\.ts$/, /node_modules/, /__tests__/, /\.test\./, /\.spec\./],
    });

    const circular: string[][] = result.circular();

    return { circular };
}
