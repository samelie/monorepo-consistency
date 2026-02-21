import type { TazeConfig } from "../config/schema";
import { existsSync } from "node:fs";
import process from "node:process";
import { $ } from "zx";
import { logger } from "../utils/logger";

/**
 * Run taze command with optional config file
 */
interface TazeRunOptions {
    /** Taze configuration from config file */
    config?: TazeConfig;

    /** Additional CLI arguments to pass to taze */
    args?: string[];

    /** Working directory */
    cwd?: string;

    /** Whether to capture output */
    silent?: boolean;
}

/**
 * Run taze with the configured runner and config file
 */
export async function runTaze(options: TazeRunOptions = {}): Promise<void> {
    const {
        config,
        args = [],
        cwd = process.cwd(),
        silent = false,
    } = options;

    // Use configured runner or default to npx
    const runner = config?.runner || "npx";

    // Build command arguments
    const commandArgs = ["taze"];

    // Add cwd option if specified
    if (cwd && cwd !== process.cwd()) {
        commandArgs.push("--cwd", cwd);
    }

    // Add config file if specified and exists
    if (config?.configPath && existsSync(config.configPath)) {
        logger.debug(`Using taze config: ${config.configPath}`);
    // Taze doesn't have a --config flag, it uses cosmiconfig
    // So we need to run from the directory containing the config
    // or rely on taze's auto-discovery
    }

    // Add any additional arguments
    commandArgs.push(...args);

    const command = `${runner} ${commandArgs.join(" ")}`;
    logger.debug(`Running: ${command}`);

    try {
    // Configure zx
        $.cwd = cwd;
        $.verbose = !silent;

        // Execute command
        await $`${runner} ${commandArgs}`;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Taze command failed: ${message}`);
        throw error;
    }
}
