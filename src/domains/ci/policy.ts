import { z } from "zod/v4";

export const ciTasks = ["test", "types", "lint", "knip"] as const;
export type CiTask = typeof ciTasks[number];

const taskPolicySchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("children"), reason: z.string().min(1) }),
    z.object({ kind: z.literal("script"), script: z.string().min(1) }),
    z.object({ kind: z.literal("command"), command: z.string().min(1), args: z.array(z.string()) }),
]);

export const ciSchedulingSchema = z.object({
    concurrency: z.number().int().min(1).max(16).default(2),
    allOnChange: z.array(z.string()).default([]),
    packages: z.record(z.string(), z.partialRecord(z.enum(ciTasks), taskPolicySchema)).default({}),
});

export type CiScheduling = z.infer<typeof ciSchedulingSchema>;
