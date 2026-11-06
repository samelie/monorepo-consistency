import type { CiPlan } from "../../src/domains/ci/planner";
import { describe, expect, it } from "vitest";
import { executeCommand } from "../../src/domains/ci/process";
import { runCiPlan } from "../../src/domains/ci/runner";

const plan: CiPlan = {
    reason: "cancellation regression", concurrency: 2, packages: ["a", "b"], wrappers: [], placeholders: [],
    targets: [
        { package: "a", task: "test", command: "node", args: ["a"] },
        { package: "b", task: "test", command: "node", args: ["b"] },
        { package: "a", task: "types", command: "node", args: ["queued"] },
    ],
};

describe("cI cancellation", () => {
    it("awaits active teardown, forwards cancellation and starts no queued work", async () => {
        const controller = new AbortController();
        const calls: string[] = [];
        const finished: string[] = [];
        const result = runCiPlan(plan, "/repo", async (_command, args, _cwd, signal) => {
            calls.push(args[0]!);
            await new Promise<void>(resolve => signal?.addEventListener("abort", () => {
                setTimeout(() => {
                    finished.push(args[0]!);
                    resolve();
                }, 10);
            }, { once: true }));
            return 130;
        }, controller.signal);
        expect(calls).toEqual(["a", "b"]);
        controller.abort();
        const results = await result;
        expect(calls).toEqual(["a", "b"]);
        expect(finished.sort()).toEqual(["a", "b"]);
        expect(results.map(result => result.exitCode)).toEqual([130, 130]);
    });

    it("does not spawn a command or queue after pre-cancellation", async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await executeCommand("missing-owned-command", [], "/repo", controller.signal)).toBe(130);
        const calls: string[] = [];
        expect(await runCiPlan(plan, "/repo", async command => {
            calls.push(command);
            return 0;
        }, controller.signal)).toEqual([]);
        expect(calls).toEqual([]);
    });
});
