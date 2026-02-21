import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { $ } from "zx";
import * as logger from "../../utils/logger";
import { findWorkspaceRoot, loadPackageJson } from "../../utils/workspace";

interface InitPublicOptions {
    packageName: string;
    sourcePath: string;
    yes?: boolean;
    githubUsername?: string;
}

const initPublic = async (options: InitPublicOptions): Promise<{ success: boolean }> => {
    const root = await findWorkspaceRoot();
    const absSourcePath = resolve(root, options.sourcePath);

    // Validate source path
    if (!existsSync(absSourcePath)) {
        throw new Error(`Source path does not exist: ${options.sourcePath}`);
    }

    const pkgJson = await loadPackageJson(absSourcePath);
    const npmName = pkgJson.name;
    const description = "description" in pkgJson && typeof pkgJson.description === "string" ? pkgJson.description : "Package from monorepo";

    // Resolve github username
    let githubUsername = options.githubUsername;
    if (!githubUsername) {
        try {
            const configManager = await import("../../config/loader");
            const config = configManager.ConfigManager.getInstance().getConfig();
            githubUsername = (config as Record<string, unknown> & { publish?: { githubUsername?: string } }).publish?.githubUsername;
        } catch {
            // No config
        }
    }

    if (!githubUsername) {
        throw new Error("GitHub username required — pass --github-username or set publish.githubUsername in config");
    }

    const repoFullName = `${githubUsername}/${options.packageName}`;

    logger.info(`Package: ${npmName}`);
    logger.info(`Source:  ${options.sourcePath}`);
    logger.info(`Repo:    ${repoFullName}`);

    // Create GitHub repo
    logger.info(`Creating GitHub repo: ${repoFullName}`);
    try {
        await $`gh repo create ${repoFullName} --public --description ${description}`;
        logger.success(`Repository created: ${repoFullName}`);
    } catch {
        logger.warn("Repository might already exist or creation failed — continuing");
    }

    // Update sync-config.yaml
    const syncConfigPath = join(root, ".github", "sync-config.yaml");
    if (existsSync(syncConfigPath)) {
        const syncConfigRaw = await readFile(syncConfigPath, "utf-8");
        const syncConfig = parseYaml(syncConfigRaw) as { packages?: Array<Record<string, unknown>> };

        if (!syncConfig.packages) {
            syncConfig.packages = [];
        }

        const exists = syncConfig.packages.some(p => p.name === options.packageName);
        if (exists) {
            logger.warn("Package already in sync config");
        } else {
            syncConfig.packages.push({
                name: options.packageName,
                source_path: options.sourcePath,
                public_repo: repoFullName,
                npm_name: npmName,
                description,
            });
            await writeFile(syncConfigPath, stringifyYaml(syncConfig), "utf-8");
            logger.success("Added to sync config");
        }
    } else {
        logger.warn(`Sync config not found at ${syncConfigPath} — skipping`);
    }

    logger.success(`Initialized public repo for ${npmName}`);
    return { success: true };
};

export const publishHandler = { initPublic };
