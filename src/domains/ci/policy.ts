import { z } from "zod/v4";

export const ciTasks = ["test", "types", "lint", "knip"] as const;
export type CiTask = typeof ciTasks[number];

// capabilities the ci workflow provisions before a shard's tests run
export const ciRequirements = ["chromium", "redis"] as const;
export type CiRequirement = typeof ciRequirements[number];

const taskPolicySchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("children"), reason: z.string().min(1) }),
    // the check runs in another gate (e.g. a dedicated workflow job), never in the planned shards
    z.object({ kind: z.literal("skip"), reason: z.string().min(1) }),
    z.object({ kind: z.literal("script"), script: z.string().min(1) }),
    z.object({ kind: z.literal("command"), command: z.string().min(1), args: z.array(z.string()) }),
]);

export const ciSchedulingSchema = z.object({
    concurrency: z.number().int().min(1).max(16).default(2),
    timeoutMinutes: z.number().int().min(1).max(120).default(15),
    maxShards: z.number().int().min(1).max(16).default(1),
    shardWeight: z.number().int().min(1).default(400),
    allOnChange: z.array(z.string()).default([]),
    impacts: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
    requires: z.record(z.string().min(1), z.array(z.enum(ciRequirements))).default({}),
    packages: z.record(z.string(), z.partialRecord(z.enum(ciTasks), taskPolicySchema)).default({}),
});

export type CiScheduling = z.infer<typeof ciSchedulingSchema>;
