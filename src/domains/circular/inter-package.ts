import type { PackageInfo } from "../../types/index";

/**
 * Detect circular dependency chains between workspace packages.
 * Uses DFS with white/gray/black coloring to find back edges.
 *
 * Only considers `workspace:*` dependencies (both deps + devDeps).
 */
export function detectInterPackageCycles(packages: PackageInfo[]): string[][] {
    // Build adjacency list: packageName -> set of dependent package names
    const nameSet = new Set(packages.map(p => p.name));
    const adj = new Map<string, string[]>();

    for (const pkg of packages) {
        const neighbors: string[] = [];
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        for (const [dep, version] of Object.entries(allDeps)) {
            if (version.startsWith("workspace:") && nameSet.has(dep)) {
                neighbors.push(dep);
            }
        }
        adj.set(pkg.name, neighbors);
    }

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    const color = new Map<string, number>();
    for (const name of nameSet) {
        color.set(name, WHITE);
    }

    const cycles: string[][] = [];
    const path: string[] = [];

    function dfs(node: string): void {
        color.set(node, GRAY);
        path.push(node);

        for (const neighbor of adj.get(node) ?? []) {
            const c = color.get(neighbor);
            if (c === GRAY) {
                // Back edge — extract cycle from path
                const cycleStart = path.indexOf(neighbor);
                if (cycleStart !== -1) {
                    cycles.push(path.slice(cycleStart));
                }
            } else if (c === WHITE) {
                dfs(neighbor);
            }
        }

        path.pop();
        color.set(node, BLACK);
    }

    for (const name of nameSet) {
        if (color.get(name) === WHITE) {
            dfs(name);
        }
    }

    return cycles;
}
