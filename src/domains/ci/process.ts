import { spawn } from "node:child_process";
import process from "node:process";

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

export type OutputSink = (chunk: Buffer) => void;

export const executeCommand = (command: string, args: readonly string[], cwd: string, signal?: AbortSignal, output?: OutputSink): Promise<number> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) return resolve(130);
        const child = spawn(command, args, { cwd, stdio: output ? ["ignore", "pipe", "pipe"] : "inherit", shell: false, detached: process.platform !== "win32" });
        if (output) {
            child.stdout?.on("data", output);
            child.stderr?.on("data", output);
        }
        let failure: Error | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stop = (sig: NodeJS.Signals) => {
            if (!child.pid) return;
            try {
                if (process.platform === "win32") child.kill(sig);
                else process.kill(-child.pid, sig);
            } catch (error) {
                if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) failure = error instanceof Error ? error : new Error(String(error));
            }
        };
        const abort = () => {
            stop("SIGTERM");
            // allow bounded child shutdown, independent database cleanup and final client reaping
            timer = setTimeout(stop, 150_000, "SIGKILL");
            timer.unref();
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        child.on("error", error => { failure = error; });
        child.on("close", (code, childSignal) => {
            if (signal?.aborted) stop("SIGKILL");
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            if (failure) reject(failure);
            else resolve(signal?.aborted ? 130 : (code ?? (childSignal ? 128 : 1)));
        });
    });
