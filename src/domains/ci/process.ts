import { spawn } from "node:child_process";

export const captureCommand = (command: string, args: readonly string[], cwd: string): Promise<string> =>
    new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", reject);
        child.on("close", code => {
            if (code !== 0) reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${Buffer.concat(stderr).toString()}`));
            else resolve(Buffer.concat(stdout).toString());
        });
    });

export const executeCommand = (command: string, args: readonly string[], cwd: string): Promise<number> =>
    new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
        child.on("error", reject);
        child.on("close", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    });
