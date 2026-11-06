import { readFile } from "node:fs/promises";
import process from "node:process";
import { Command } from "commander";
import { loadConfig } from "../config/loader";
import { ciPlanSchema, collectCiPlan } from "../domains/ci/planner";
import { ciSchedulingSchema, ciTasks } from "../domains/ci/policy";
import { runCiPlan } from "../domains/ci/runner";
import { findWorkspaceRoot } from "../utils/workspace";

export const createCiCommand = (): Command => {
    const ci = new Command("ci").description("Plan and run bounded direct workspace checks");
    for (const name of ["plan", "run", "mirror"]) {
        ci.command(name)
            .description(name === "plan" ? "Print exact CI targets as JSON" : "Run the same planned CI targets")
            .option("--base <ref>", "select changes and dependents since a verified git ref")
            .option("--plan <file>", "execute a previously printed JSON plan")
            .option("--tasks <tasks>", "comma-separated test,types,lint,knip", name === "mirror" ? "types,lint" : "test,types,lint,knip")
            .action(async (options: { base?: string; tasks: string; plan?: string }, command: Command) => {
                const controller = new AbortController();
                const interrupt = () => controller.abort(new Error("CI cancelled by SIGINT"));
                const terminate = () => controller.abort(new Error("CI cancelled by SIGTERM"));
                process.on("SIGINT", interrupt);
                process.on("SIGTERM", terminate);
                try {
                    const globals = command.optsWithGlobals();
                    const root = await findWorkspaceRoot(globals.cwd);
                    const config = await loadConfig({ cwd: root, configPath: globals.config });
                    const tasks = options.tasks.split(",").map(value => {
                        const task = ciTasks.find(task => task === value);
                        if (!task) throw new Error(`Unknown CI task: ${value}`);
                        return task;
                    });
                    const policy = ciSchedulingSchema.parse(config.ci?.scheduling ?? {});
                    if (options.plan && options.base) throw new Error("Use either --plan or --base");
                    const plan = options.plan
                        ? ciPlanSchema.parse(JSON.parse(await readFile(options.plan, "utf8")))
                        : await collectCiPlan(root, policy, tasks, options.base);
                    plan.targets = plan.targets.filter(target => tasks.includes(target.task));
                    plan.wrappers = plan.wrappers.filter(target => tasks.includes(target.task));
                    plan.placeholders = plan.placeholders.filter(target => tasks.includes(target.task));
                    controller.signal.throwIfAborted();
                    if (name === "plan") {
                        process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
                        return;
                    }
                    process.stdout.write(`CI ${plan.reason}: ${plan.targets.length} scripts, ${plan.wrappers.length} wrappers omitted, ${plan.placeholders.length} existing placeholders\n`);
                    const results = await runCiPlan(plan, root, undefined, controller.signal);
                    const failures = results.filter(result => result.exitCode !== 0);
                    process.stdout.write(`${JSON.stringify({ executed: results.length, placeholders: plan.placeholders.length, failures }, null, 2)}\n`);
                    process.exitCode = controller.signal.aborted || failures.length > 0 || (plan.targets.length > 0 && results.length !== plan.targets.length) ? 1 : 0;
                } catch (error) {
                    process.stderr.write(`CI failed: ${String(error)}\n`);
                    process.exitCode = 1;
                } finally {
                    process.removeListener("SIGINT", interrupt);
                    process.removeListener("SIGTERM", terminate);
                }
            });
    }
    return ci;
};
