import { $ } from "zx";
import { ConfigManager } from "../../config/loader";
import * as logger from "../../utils/logger";

interface BuildOptions {
    packages?: string[];
    dryRun?: boolean;
    cwd?: string;
}

const run = async (options: BuildOptions): Promise<{ success: boolean; built: string[] }> => {
    const prevEnv = $.env;
    $.env = { ...process.env, FORCE_COLOR: "1" };

    let packages = options.packages;

    if (!packages?.length) {
        try {
            const config = ConfigManager.getInstance().getConfig();
            packages = (config as Record<string, unknown> & { build?: { orderedPackages?: string[] } }).build?.orderedPackages;
        } catch {
            // No config loaded
        }
    }

    if (!packages?.length) {
        logger.warn("No packages configured in build.orderedPackages");
        $.env = prevEnv;
        return { success: true, built: [] };
    }

    const built: string[] = [];

    for (const pkg of packages) {
        if (options.dryRun) {
            logger.info(`[DRY RUN] pnpm --filter="${pkg}" build`);
            continue;
        }
        logger.info(`Building ${pkg}...`);
        await $`pnpm --filter=${pkg} build`;
        logger.success(`Built ${pkg}`);
        built.push(pkg);
    }

    $.env = prevEnv;
    return { success: true, built };
};

export const buildHandler = { run };
