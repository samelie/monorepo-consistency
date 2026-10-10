import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import process from "node:process";
import { stripVTControlCharacters } from "node:util";
import { logger } from "../utils/logger";

const diagnosticLimit = 32 * 1024;

interface CommandResult {
    code: number | null;
    signal: NodeJS.Signals | null;
    diagnostics: string;
}

const runCommand = (cwd: string, args: string[]) => new Promise<CommandResult>((resolve, reject) => {
    const child = spawn("pnpm", args, { cwd, stdio: ["inherit", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    const capture = (previous: Buffer, chunk: Buffer) => {
        // copy the tail so a large chunk cannot retain an unbounded backing buffer.
        if (chunk.length >= diagnosticLimit) return Buffer.from(chunk.subarray(-diagnosticLimit));
        return Buffer.concat([previous.subarray(-(diagnosticLimit - chunk.length)), chunk]);
    };
    child.stdout.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
        stdout = capture(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
        process.stderr.write(chunk);
        stderr = capture(stderr, chunk);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, diagnostics: `${stdout}\n${stderr}` }));
});

const missingPackage = (result: CommandResult) => {
    if (result.signal || result.code === 0) return;
    const diagnostics = stripVTControlCharacters(result.diagnostics);
    // pnpm's native renderer can wrap both before and within a package name.
    const match = diagnostics.match(/(?:^|\n)\s*(?:Error:\s*)?ERR_PNPM_NO_MATCHING_VERSION\s[\s\S]*?No matching version found for\s+(@?[a-z0-9/._-]+(?:\r?\n[\t ]+[a-z0-9/._-]+)*)@\S+\s+while fetching it from\s+https?:\/\//);
    const name = match?.[1]?.replace(/\r?\n[\t ]+/g, "");
    return name && name.length <= 214 && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) ? name : undefined;
};

const assertSuccess = (result: CommandResult, operation: string) => {
    if (result.code !== 0 || result.signal) {
        throw new Error(`${operation} failed (${result.signal || result.code})`);
    }
};

export const installWorkspace = async (cwd: string, ignorePnpmfile = false) => {
    const args = ["--filter", "*", "install", "--no-frozen-lockfile"];
    if (ignorePnpmfile) args.push("--ignore-pnpmfile");
    const result = await runCommand(cwd, args);
    const name = missingPackage(result);
    if (!name) {
        assertSuccess(result, "Workspace install");
        return;
    }
    logger.warn(`Refreshing pnpm metadata for ${name} after ERR_PNPM_NO_MATCHING_VERSION; retrying install once`);
    const cacheArgs = [...(ignorePnpmfile ? ["--ignore-pnpmfile"] : []), "cache", "delete", name];
    assertSuccess(await runCommand(cwd, cacheArgs), "Package metadata refresh");
    assertSuccess(await runCommand(cwd, args), "Workspace install");
};
