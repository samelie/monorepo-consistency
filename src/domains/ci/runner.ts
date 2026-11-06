import type { CiPlan, CiTarget } from "./planner";
import process from "node:process";
import { executeCommand } from "./process";

export interface CiResult { target: CiTarget; exitCode: number; error?: string }

export const runCiPlan = async (
    plan: CiPlan,
    cwd: string,
    execute = executeCommand,
): Promise<CiResult[]> => {
    if (!Number.isInteger(plan.concurrency) || plan.concurrency < 1 || plan.concurrency > 16) throw new Error("Invalid CI concurrency");
    const results: CiResult[] = [];
    const queue = [...plan.targets];
    const activePackages = new Set<string>();
    const worker = async () => {
        while (queue.length > 0) {
            const index = queue.findIndex(target => !activePackages.has(target.package));
            if (index < 0) return;
            const target = queue.splice(index, 1)[0]!;
            activePackages.add(target.package);
            process.stdout.write(`CI start ${target.package}:${target.task}\n`);
            try {
                results.push({ target, exitCode: await execute(target.command, target.args, cwd) });
            } catch (error) {
                results.push({ target, exitCode: 1, error: String(error) });
            } finally {
                activePackages.delete(target.package);
            }
        }
    };
    await Promise.all(Array.from({ length: plan.concurrency }, worker));
    return results;
};
