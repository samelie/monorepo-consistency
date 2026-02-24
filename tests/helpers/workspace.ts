import type { MonorepoConfig } from "@rad/..";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

interface TempWorkspaceOptions {
    /** Files to create: { 'path/to/file.json': 'content' } */
    files?: Record<string, string>;
    /** pnpm-workspace.yaml patterns */
    workspacePatterns?: string[];
    /** Packages to create: { 'pkg-name': { name, version, scripts?, etc } } */
    packages?: Record<string, Record<string, unknown>>;
    /** Config to create */
    config?: Partial<MonorepoConfig>;
}

export class TempWorkspace {
    constructor(public readonly root: string) {}

    /** Get absolute path within workspace */
    path(...segments: string[]): string {
        return join(this.root, ...segments);
    }

    /** Read a file */
    async readFile(filePath: string): Promise<string> {
        return readFile(this.path(filePath), "utf-8");
    }

    /** Read and parse JSON */
    async readJSON<T = unknown>(filePath: string): Promise<T> {
        const content = await this.readFile(filePath);
        return JSON.parse(content) as T;
    }

    /** Write a file */
    async writeFile(filePath: string, content: string): Promise<void> {
        const fullPath = this.path(filePath);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, "utf-8");
    }

    /** Write JSON file */
    async writeJSON(filePath: string, data: unknown): Promise<void> {
        await this.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
    }

    /** Cleanup workspace */
    async cleanup(): Promise<void> {
        await rm(this.root, { recursive: true, force: true });
    }
}

/**
 * Create a temporary workspace for testing
 */
export async function createTempWorkspace(
    options: TempWorkspaceOptions = {},
): Promise<TempWorkspace> {
    const root = await mkdtemp(join(tmpdir(), "mono-test-"));
    const workspace = new TempWorkspace(root);

    // Create pnpm-workspace.yaml
    const patterns = options.workspacePatterns || ["packages/*"];
    await workspace.writeFile(
        "pnpm-workspace.yaml",
        `packages:\n${patterns.map(p => `  - ${p}`).join("\n")}\n`,
    );

    // Create root package.json
    await workspace.writeJSON("package.json", {
        name: "test-workspace",
        version: "0.0.0",
        private: true,
    });

    // Create packages
    if (options.packages) {
        for (const [pkgName, pkgData] of Object.entries(options.packages)) {
            const pkgPath = `packages/${pkgName}`;
            await workspace.writeJSON(`${pkgPath}/package.json`, {
                name: pkgData.name || pkgName,
                version: pkgData.version || "1.0.0",
                ...pkgData,
            });
        }
    }

    // Create config file
    if (options.config) {
        await workspace.writeJSON("monorepo.config.json", options.config);
    }

    // Create custom files
    if (options.files) {
        for (const [filePath, content] of Object.entries(options.files)) {
            await workspace.writeFile(filePath, content);
        }
    }

    return workspace;
}
