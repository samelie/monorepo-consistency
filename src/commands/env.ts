import { Command } from "commander";
import { envHandler } from "../domains/env/index.js";
import { logger } from "../utils/logger.js";

export function createEnvCommand(): Command {
    const env = new Command("env")
        .description("Encode/decode .env files to/from base64");

    env
        .command("encode <file>")
        .description("Encode a .env file to base64")
        .option("--copy", "copy encoded output to clipboard")
        .action(async (file: string, options: { copy?: boolean }) => {
            try {
                const encoded = await envHandler.encode({
                    filePath: file,
                    copy: options.copy,
                });
                console.log(encoded);
            } catch (error) {
                logger.error(`Failed to encode: ${error}`);
                process.exit(1);
            }
        });

    env
        .command("decode <base64>")
        .description("Decode base64 string back to .env content")
        .option("-o, --output <file>", "write decoded content to file")
        .action(async (base64: string, options: { output?: string }) => {
            try {
                const decoded = await envHandler.decode({
                    encoded: base64,
                    output: options.output,
                });
                if (!options.output) {
                    console.log(decoded);
                }
            } catch (error) {
                logger.error(`Failed to decode: ${error}`);
                process.exit(1);
            }
        });

    return env;
}
