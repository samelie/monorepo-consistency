import type { PackageInfo, WorkspaceInfo } from "../types/index";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";

/**
 * Find the workspace root by looking for pnpm-workspace.yaml
 */
export async function findWorkspaceRoot(cwd: string = process.cwd()): Promise<string> {
    let dir = resolve(cwd);

    while (dir !== "/") {
        if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
            return dir;
        }
        const parent = resolve(dir, "..");
        if (parent === dir) break;
        dir = parent;
    }

    throw new Error("Not in a pnpm workspace (pnpm-workspace.yaml not found)");
}

/**
 * Parse pnpm-workspace.yaml to get workspace patterns
 */
async function parseWorkspaceYaml(workspaceRoot: string): Promise<string[]> {
    const yamlPath = join(workspaceRoot, "pnpm-workspace.yaml");
    const content = await readFile(yamlPath, "utf-8");
    const parsed = parseYaml(content) as { packages?: string[] };
    return parsed.packages || [];
}

/**
 * Get all workspace package paths using glob patterns
 */
async function getWorkspacePackagePaths(
    workspaceRoot: string,
): Promise<string[]> {
    const patterns = await parseWorkspaceYaml(workspaceRoot);

    // Use fast-glob to resolve patterns
    const packagePaths = await fg(patterns, {
        cwd: workspaceRoot,
        onlyDirectories: true,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.*/**"],
    });

    // Filter to only directories with package.json
    const validPaths: string[] = [];
    for (const pkgPath of packagePaths) {
        const packageJsonPath = join(pkgPath, "package.json");
        try {
            await readFile(packageJsonPath, "utf-8");
            validPaths.push(pkgPath);
        } catch {
            // Skip directories without package.json
        }
    }

    return validPaths;
}

/**
 * Get workspace information with all packages loaded
 */
export async function getWorkspaceInfo(cwd?: string): Promise<WorkspaceInfo> {
    // Always search up from cwd to find the workspace root
    const workspaceRoot = await findWorkspaceRoot(cwd);
    const packagePaths = await getWorkspacePackagePaths(workspaceRoot);

    // Load package.json for each path
    const packages: PackageInfo[] = [];
    for (const pkgPath of packagePaths) {
        try {
            const pkg = await loadPackageJson(pkgPath);
            packages.push(pkg);
        } catch (error) {
            // Log warning but continue with other packages
            console.warn(`Failed to load package at ${pkgPath}:`, error);
        }
    }

    return {
        root: workspaceRoot,
        packages,
        lockfile: join(workspaceRoot, "pnpm-lock.yaml"),
        workspaceFile: join(workspaceRoot, "pnpm-workspace.yaml"),
    };
}

/**
 * Load package.json from a path
 */
export async function loadPackageJson(packagePath: string): Promise<PackageInfo> {
    const content = await readFile(join(packagePath, "package.json"), "utf-8");
    const pkg = JSON.parse(content);

    return {
        name: pkg.name,
        path: packagePath,
        version: pkg.version,
        private: pkg.private || false,
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
        scripts: pkg.scripts,
    };
}
