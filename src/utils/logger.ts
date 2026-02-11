import type { Ora } from "ora";
import chalk from "chalk";
import ora from "ora";

interface LoggerOptions {
    verbose?: boolean;
    silent?: boolean;
    noColor?: boolean;
}

// Store logger configuration in a closure
let loggerOptions: LoggerOptions = {};

export const configure = (options: LoggerOptions): void => {
    loggerOptions = { ...options };
    if (options.noColor) {
        chalk.level = 0;
    }
};

export const info = (message: string): void => {
    if (!loggerOptions.silent) {
        console.log(chalk.blue("ℹ"), message);
    }
};

export const success = (message: string): void => {
    if (!loggerOptions.silent) {
        console.log(chalk.green("✓"), message);
    }
};

export const warn = (message: string): void => {
    if (!loggerOptions.silent) {
        console.log(chalk.yellow("⚠"), message);
    }
};

export const error = (message: string): void => {
    if (!loggerOptions.silent) {
        console.error(chalk.red("✗"), message);
    }
};

export const debug = (message: string): void => {
    if (loggerOptions.verbose && !loggerOptions.silent) {
        console.log(chalk.gray("→"), message);
    }
};

export const spinner = (text: string): Ora | ReturnType<typeof createNoopSpinner> => {
    if (loggerOptions.silent) {
        return createNoopSpinner();
    }
    return ora(text);
};

const createNoopSpinner = () => ({
    start: () => createNoopSpinner(),
    succeed: () => createNoopSpinner(),
    fail: () => createNoopSpinner(),
    info: () => createNoopSpinner(),
    stop: () => createNoopSpinner(),
    text: "",
    isSpinning: false,
});

export const json = (data: unknown): void => {
    console.log(JSON.stringify(data, null, 2));
};

// Export a logger object for backward compatibility, but it's just a collection of functions
export const logger = {
    configure,
    info,
    success,
    warn,
    error,
    debug,
    spinner,
    json,
};
