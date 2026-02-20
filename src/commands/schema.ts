import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { Command } from "commander";
import {
    createConfigTemplate,
    generateTypeScriptDefinitions,
    writeJsonSchemaToFile,
} from "../config/json-schema.js";
import { logger } from "../utils/logger.js";

export function createSchemaCommand(): Command {
    const command = new Command("schema");

    command
        .description("Generate configuration schemas and templates")
        .option("-o, --output <path>", "output file path")
        .option("--format <type>", "output format (json|typescript|template)", "json")
        .option("--force", "overwrite existing files")
        .action(async options => {
            try {
                const cwd = command.optsWithGlobals().cwd || process.cwd();
                const outputPath = options.output
                    ? resolve(cwd, options.output)
                    : undefined;

                switch (options.format) {
                    case "json": {
                        const filePath = writeJsonSchemaToFile(outputPath);
                        logger.success(`JSON Schema generated: ${filePath}`);
                        break;
                    }

                    case "typescript": {
                        const definitions = generateTypeScriptDefinitions();
                        const filePath = outputPath || resolve(cwd, "monorepo.d.ts");
                        writeFileSync(filePath, definitions, "utf-8");
                        logger.success(`TypeScript definitions generated: ${filePath}`);
                        break;
                    }

                    case "template": {
                        const template = createConfigTemplate();
                        const filePath = outputPath || resolve(cwd, "monorepo.config.template.json");
                        if (existsSync(filePath) && !options.force) {
                            logger.error(`File already exists: ${filePath}`);
                            logger.info("Use --force to overwrite or --output to specify a different path");
                            process.exit(1);
                        }
                        writeFileSync(filePath, `${JSON.stringify(template, null, 2)}\n`, "utf-8");
                        logger.success(`Configuration template generated: ${filePath}`);
                        break;
                    }

                    default:
                        logger.error(`Unknown format: ${options.format}`);
                        process.exit(1);
                }
            } catch (error) {
                logger.error(`Failed to generate schema: ${String(error)}`);
                process.exit(1);
            }
        });

    // Subcommand for validating a config file
    command
        .command("validate")
        .description("Validate a configuration file")
        .argument("<file>", "configuration file to validate")
        .action(async file => {
            try {
                const { loadConfig } = await import("../config/loader.js");
                const cwd = command.optsWithGlobals().cwd || process.cwd();
                const configPath = resolve(cwd, file);

                logger.info(`Validating configuration: ${configPath}`);

                await loadConfig({
                    configPath,
                    validate: true,
                });

                logger.success("Configuration is valid!");
            } catch (error) {
                logger.error(`Configuration validation failed:`);
                logger.error(String(error));
                process.exit(1);
            }
        });

    return command;
}
