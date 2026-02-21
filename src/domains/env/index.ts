import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import * as logger from "../../utils/logger";

async function copyToClipboard(text: string): Promise<void> {
    switch (process.platform) {
        case "darwin":
            execSync("pbcopy", { input: text });
            break;
        case "win32":
            execSync("clip", { input: text });
            break;
        case "linux":
            execSync("xclip -selection clipboard", { input: text });
            break;
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}

interface EncodeOptions {
    filePath: string;
    copy?: boolean;
}

interface DecodeOptions {
    encoded: string;
    output?: string;
}

const encode = async (options: EncodeOptions): Promise<string> => {
    const resolvedPath = resolve(options.filePath);
    const content = await readFile(resolvedPath, "utf-8");
    const encoded = Buffer.from(content).toString("base64");

    logger.info(`Encoded ${resolvedPath} (${content.length} bytes -> ${encoded.length} base64 chars)`);

    if (options.copy) {
        await copyToClipboard(encoded);
        logger.success("Copied to clipboard");
    }

    return encoded;
};

const decode = async (options: DecodeOptions): Promise<string> => {
    const decoded = Buffer.from(options.encoded, "base64").toString("utf-8");

    if (options.output) {
        await writeFile(options.output, decoded, "utf-8");
        logger.success(`Decoded content written to ${options.output}`);
    }

    return decoded;
};

export const envHandler = { encode, decode };
