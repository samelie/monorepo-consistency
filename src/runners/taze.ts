import type { CheckOptions, RawDep, ResolvedDepChange } from "taze";
import type { TazeConfig } from "../config/schema";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { minimatch } from "minimatch";
import { loadPackage, resolveDependencies, writePackage } from "taze";
import { logger } from "../utils/logger";
import { installWorkspace } from "./workspace-install";

interface TazeRunOptions extends CheckOptions {
    config?: TazeConfig;
    dryRun?: boolean;
    report?: string;
}

const executeFile = promisify(execFile);
const dependencyKey = (dep: RawDep) => JSON.stringify(dep);
const matches = (name: string, patterns: string | string[] = []) =>
    (Array.isArray(patterns) ? patterns : [patterns]).some(pattern =>
        pattern.startsWith("/") && pattern.endsWith("/")
            ? new RegExp(pattern.slice(1, -1)).test(name)
            : minimatch(name, pattern));

export const runTaze = async (options: TazeRunOptions = {}) => {
    const { config, dryRun, report, ...requested } = options;
    const cwd = options.cwd || process.cwd();
    const inherited: CheckOptions = config?.configPath
        ? (await import(pathToFileURL(resolve(cwd, config.configPath)).href)).default
        : {};
    const settings: CheckOptions = {
        ...inherited,
        ...requested,
        cwd,
        force: true,
        recursive: false,
        githubActions: false,
        nodeVersion: false,
        write: !dryRun && (requested.write ?? inherited.write ?? false),
        install: !dryRun && (requested.install ?? inherited.install ?? false),
        depFields: {
            ...inherited.depFields,
            ...requested.depFields,
            "overrides": false,
            "pnpm.overrides": false,
            "resolutions": false,
        },
    };
    if (settings.interactive) throw new Error("Workspace updates require explicit --write; use deps preview to review first.");
    if (settings.install && !settings.write) throw new Error("--install requires --write");

    const { stdout } = await executeFile("pnpm", ["--filter", "*", "list", "--depth", "-1", "--json"], { cwd, maxBuffer: 16 * 1024 * 1024 });
    const members: unknown = JSON.parse(stdout);
    if (!Array.isArray(members) || members.some(member => typeof member?.path !== "string")) {
        throw new Error("pnpm returned an invalid workspace inventory");
    }
    const paths = settings.recursive === false && requested.recursive === false
        ? [cwd]
        : [...new Set([cwd, ...members.map((member: { path: string }) => member.path)])];
    logger.info(`Loading ${paths.length} pnpm package manifests (including root) using local Taze`);
    const shouldUpdate = (name: string) =>
        (!settings.include?.length || matches(name, settings.include)) && !matches(name, settings.exclude);
    const packages = (await Promise.all(paths.map(path =>
        loadPackage(relative(cwd, join(path, "package.json")), settings, shouldUpdate))))
        .flat()
        .filter(pkg => pkg.type === "package.json");
    const manifestsWritten: string[] = [];
    const changes: { manifest: string; field: string; name: string; from: string; to: string }[] = [];
    const installation = { attempted: false, succeeded: false, failed: false };
    let outcome = "pending";
    let failure: string | undefined;
    let downgrades: ResolvedDepChange[] = [];
    try {
        const unique = [...new Map(packages.flatMap(pkg => pkg.deps).map(dep => [dependencyKey(dep), dep])).values()];
        logger.info(`Resolving ${unique.length} distinct dependency declarations`);
        const resolved = await resolveDependencies(unique, settings, undefined, (_name, count, total) => {
            if (count % 100 === 0 || count === total) logger.info(`Resolved ${count}/${total}`);
        });
        // dist-tags are not semver ranges; taze latest preserves their declaration.
        const tagged = unique.filter(dep => /^[a-z][\w.-]*$/i.test(dep.currentVersion));
        if (tagged.length) {
            const tags = await resolveDependencies(tagged, { ...settings, mode: "latest" });
            for (const [index, dep] of tagged.entries()) resolved[unique.indexOf(dep)] = tags[index]!;
        }
        const byDependency = new Map(unique.map((dep, index) => [dependencyKey(dep), resolved[index]!]));
        for (const pkg of packages) pkg.resolved = pkg.deps.map(dep => byDependency.get(dependencyKey(dep))!);
        // taze labels valid downgrades as diff=error; upgrades preserve newer declarations.
        downgrades = resolved.filter(dep => dep.diff === "error" && !dep.resolveError && !dep.update && dep.targetVersion !== dep.currentVersion);
        const errors = resolved.filter(dep => dep.resolveError || (dep.diff === "error" && !downgrades.includes(dep)));
        for (const dep of downgrades) logger.warn(`Retaining ${dep.name}@${dep.currentVersion}: Taze proposed older ${dep.targetVersion}`);
        changes.push(...packages.flatMap(pkg => pkg.resolved.filter(dep => dep.update).map(dep => ({
            manifest: pkg.relative,
            field: dep.source,
            name: dep.name,
            from: dep.currentVersion,
            to: dep.targetVersion,
        }))));
        const prereleases = resolved.filter(dep => dep.update && /\d+\.\d+\.\d+-/.test(dep.targetVersion) && !/\d+\.\d+\.\d+-/.test(dep.currentVersion));
        if (prereleases.length) throw new Error(`Refusing new prerelease dependencies: ${prereleases.map(dep => dep.name).join(", ")}`);
        for (const change of changes) logger.info(`${change.manifest}: ${change.name} ${change.from} → ${change.to}`);
        if (errors.length) throw new Error(`Failed to resolve ${errors.length} dependencies: ${errors.map(dep => `${dep.name}: ${dep.resolveError || dep.diff}`).join(", ")}`);
        logger.info(`${changes.length} declaration updates in ${packages.filter(pkg => pkg.resolved.some(dep => dep.update)).length} manifests`);
        if (settings.write) {
            for (const pkg of packages) {
                if (pkg.resolved.some(dep => dep.update)) {
                    await writePackage(pkg, settings);
                    manifestsWritten.push(pkg.relative);
                }
            }
            logger.info(`Wrote updates across ${manifestsWritten.length} manifests`);
            if (settings.install) {
                installation.attempted = true;
                await installWorkspace(cwd, config?.ignorePnpmfile);
                installation.succeeded = true;
            }
        }
        outcome = settings.write ? "success" : "preview";
        return packages;
    } catch (error) {
        outcome = "failed";
        failure = String(error);
        installation.failed = installation.attempted && !installation.succeeded;
        throw error;
    } finally {
        if (report) {
            await writeFile(report, `${JSON.stringify({
                capturedAt: new Date().toISOString(),
                mode: settings.mode || "default",
                preview: !settings.write,
                packages: packages.map(pkg => ({
                    manifest: pkg.relative,
                    dependencies: pkg.resolved.map(dep => ({
                        name: dep.name,
                        field: dep.source,
                        current: dep.currentVersion,
                        target: dep.targetVersion,
                        update: dep.update,
                        latest: dep.pkgData?.tags.latest,
                        declaredTagVersion: dep.pkgData?.tags[dep.currentVersion],
                        targetTime: dep.targetVersionTime,
                        error: dep.resolveError ? String(dep.resolveError) : undefined,
                        diff: dep.diff,
                        exception: downgrades.includes(dep) ? "newer declaration retained; resolver proposed downgrade" : undefined,
                    })),
                })),
                outcome,
                error: failure,
                applied: manifestsWritten.length > 0,
                manifestsWritten,
                manifestsWrittenCount: manifestsWritten.length,
                proposedChanges: changes,
                appliedChanges: changes.filter(change => manifestsWritten.includes(change.manifest)),
                installation,
                installFailed: installation.failed,
            }, null, 2)}\n`);
        }
    }
};
