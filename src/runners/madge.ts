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

// Local type declarations since @types/madge uses export= pattern
interface MadgeInstance {
    circular: () => string[][];
}

interface MadgeConfig {
    fileExtensions?: string[];
    tsConfig?: string | object;
    excludeRegExp?: RegExp[];
}

type MadgeFn = (path: string | string[] | object, config?: MadgeConfig) => Promise<MadgeInstance>;

/**
 * Run madge programmatic API against a package's source directory.
 * Uses dynamic import so the tool degrades gracefully if madge isn't installed.
 */
export async function runMadge(packagePath: string, options: MadgeOptions = {}): Promise<MadgeResult> {
    let madgeFn: MadgeFn;
    try {
        // ESM/CJS interop: dynamic import of CJS module wraps export= as { default: fn }
        const madgeModule = await import("madge");
        // Handle both ESM wrapper ({ default: fn }) and direct CJS (fn)
        const maybeFn = "default" in madgeModule ? madgeModule.default : madgeModule;
        if (typeof maybeFn !== "function") {
            throw new TypeError("madge module does not export a function");
        }
        madgeFn = maybeFn as MadgeFn;
    } catch {
        throw new Error(
            "madge is not installed. Run: pnpm add -D madge",
        );
    }

    const result = await madgeFn(`${packagePath}/src`, {
        fileExtensions: options.fileExtensions ?? ["ts", "tsx", "js", "jsx"],
        tsConfig: options.tsconfig,
        excludeRegExp: [DTS_RE, NODE_MODULES_RE, TESTS_RE, TEST_FILE_RE, SPEC_FILE_RE],
    });

    const circular: string[][] = result.circular();

    return { circular };
}
