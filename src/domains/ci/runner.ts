import type { CiPlan, CiTarget } from "./planner";
import type { OutputSink } from "./process";
import process from "node:process";
import { executeCommand } from "./process";

export interface CiResult { target: CiTarget; exitCode: number; durationMs: number; timedOut?: boolean; error?: string }

export interface CiRunOptions {
    // buffer each target's output and print it as one block, so concurrent targets never interleave
    grouped?: boolean;
    write?: (text: string) => void;
    // overrides plan.timeoutMinutes, for callers that need sub-minute bounds
    timeoutMs?: number;
}

const TIMEOUT_EXIT = 124;
const label = (target: CiTarget) => `${target.package}:${target.task}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const report = (result: CiResult, output: string, options: CiRunOptions) => {
    const write = options.write ?? (text => process.stdout.write(text));
    const status = result.timedOut ? `timed out` : `exit ${result.exitCode}`;
    const summary = `${label(result.target)} ${status} in ${seconds(result.durationMs)}`;
    if (!options.grouped) {
        write(`CI done ${summary}\n`);
        return;
    }
    const body = output.endsWith("\n") || output === "" ? output : `${output}\n`;
    if (result.exitCode === 0) {
        write(`::group::pass ${summary}\n${body}::endgroup::\n`);
        return;
    }
    // failures stay expanded and raise an annotation on the run summary
    write(`::error title=${label(result.target)}::${status}${result.error ? `: ${result.error}` : ""}\n`);
    write(`---- FAIL ${summary} ----\n${body}---- end ${label(result.target)} ----\n`);
};

export const runCiPlan = async (
    plan: CiPlan,
    cwd: string,
    execute: (command: string, args: readonly string[], cwd: string, signal?: AbortSignal, output?: OutputSink) => Promise<number> = executeCommand,
    signal?: AbortSignal,
    options: CiRunOptions = {},
): Promise<CiResult[]> => {
    if (!Number.isInteger(plan.concurrency) || plan.concurrency < 1 || plan.concurrency > 16) throw new Error("Invalid CI concurrency");
    const results: CiResult[] = [];
    const queue = [...plan.targets];
    const activePackages = new Set<string>();
    const worker = async () => {
        while (!signal?.aborted && queue.length > 0) {
            const index = queue.findIndex(target => !activePackages.has(target.package));
            if (index < 0) return;
            const target = queue.splice(index, 1)[0]!;
            activePackages.add(target.package);
            process.stdout.write(`CI start ${label(target)}\n`);
            const deadline = AbortSignal.timeout(options.timeoutMs ?? plan.timeoutMinutes * 60_000);
            const targetSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
            const chunks: Buffer[] = [];
            const started = performance.now();
            let result: CiResult;
            try {
                const exitCode = await execute(target.command, target.args, cwd, targetSignal, options.grouped ? chunk => chunks.push(chunk) : undefined);
                const timedOut = deadline.aborted && !signal?.aborted;
                result = timedOut
                    ? { target, exitCode: TIMEOUT_EXIT, durationMs: performance.now() - started, timedOut, error: `exceeded the per-target timeout` }
                    : { target, exitCode, durationMs: performance.now() - started };
            } catch (error) {
                result = { target, exitCode: 1, durationMs: performance.now() - started, error: String(error) };
            } finally {
                activePackages.delete(target.package);
            }
            results.push(result);
            report(result, Buffer.concat(chunks).toString(), options);
        }
    };
    await Promise.all(Array.from({ length: plan.concurrency }, worker));
    return results;
};
