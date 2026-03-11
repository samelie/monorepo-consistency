const DTS_RE = /\.d\.ts$/;
const NODE_MODULES_RE = /node_modules/;
const TESTS_RE = /__tests__/;
const TEST_FILE_RE = /\.test\./;
const SPEC_FILE_RE = /\.spec\./;

interface MadgeOptions {
    tsconfig?: string;
    fileExtensions?: string[];
}

interface MadgeResult {
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
        excludeRegExp: [DTS_RE, NODE_MODULES_RE, TESTS_RE, TEST_FILE_RE, SPEC_FILE_RE],
    });

    const circular: string[][] = result.circular();

    return { circular };
}
