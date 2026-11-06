import type { TempWorkspace } from "../helpers/workspace.js";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConfigCommand } from "../../src/commands/config.js";
import { createKnipCommand } from "../../src/commands/knip.js";
import { createTsconfigCommand } from "../../src/commands/tsconfig.js";
import { ConfigManager } from "../../src/config/loader.js";
import { configHandler } from "../../src/domains/config/index.js";
import { knipHandler } from "../../src/domains/knip/index.js";
import { tsconfigHandler } from "../../src/domains/tsconfig/index.js";
import { createTempWorkspace } from "../helpers/workspace.js";

const generators = [
    {
        name: "typescript",
        generate: (cwd: string, packages?: readonly string[]) => tsconfigHandler.generate({ cwd, packages }),
        output: "tsconfig.json",
        command: createTsconfigCommand,
        verb: "generate",
    },
    {
        name: "knip",
        generate: (cwd: string, packages?: readonly string[]) => knipHandler.generate({ cwd, packages }),
        output: "knip.config.ts",
        command: createKnipCommand,
        verb: "generate",
    },
    {
        name: "eslint/config",
        generate: (cwd: string, packages?: readonly string[]) => configHandler.fix({ cwd, packages, addMissing: true }),
        output: "eslint.config.mjs",
        command: createConfigCommand,
        verb: "fix",
    },
];

const snapshot = async (root: string) => {
    const paths = await readdir(root, { recursive: true });
    const entries = await Promise.all(paths.sort().map(async path => {
        const absolute = join(root, path);
        return (await stat(absolute)).isFile() ? [path, await readFile(absolute, "utf8")] : undefined;
    }));
    return entries.filter(entry => entry !== undefined);
};

describe.each(generators)("$name package selection", generator => {
    let workspace: TempWorkspace;
    const manager = ConfigManager.getInstance();

    beforeEach(async () => {
        manager.reset();
        workspace = await createTempWorkspace({
            packages: {
                a: { name: "@test/a", type: "module" },
                b: { name: "@test/b", type: "module" },
            },
            files: {
                "packages/a/node.tsconfig.json": "{}\n",
                "packages/b/node.tsconfig.json": "{}\n",
            },
            config: { version: "1.0.0" },
        });
        await manager.init({ cwd: workspace.root });
    });

    afterEach(async () => {
        await workspace.cleanup();
        manager.reset();
    });

    it("writes only the explicitly requested package", async () => {
        const before = await snapshot(workspace.path("packages/b"));
        await generator.generate(workspace.root, ["@test/a"]);
        expect(await workspace.readFile(`packages/a/${generator.output}`)).toBeTruthy();
        expect(await snapshot(workspace.path("packages/b"))).toEqual(before);
        if (generator.name === "knip") {
            expect(await workspace.readFile(`packages/a/${generator.output}`)).toContain("@adddog/monorepo-consistency/knip");
        }
    });

    it.each([
        ["@test/a", "@missing/pkg"],
        [],
        [""],
        ["   "],
    ])("rejects invalid selection %j before any writes", async (...packages) => {
        const before = await snapshot(workspace.root);
        await expect(generator.generate(workspace.root, packages)).rejects.toThrow();
        expect(await snapshot(workspace.root)).toEqual(before);
    });

    it("retains all-package generation when selection is omitted", async () => {
        await generator.generate(workspace.root);
        for (const pkg of ["a", "b"]) {
            expect(await workspace.readFile(`packages/${pkg}/${generator.output}`)).toBeTruthy();
        }
    });

    it("rejects a CLI selector without names before any writes", async () => {
        const command = generator.command().exitOverride().configureOutput({ writeErr: () => {} });
        for (const subcommand of command.commands) {
            subcommand.exitOverride().configureOutput({ writeErr: () => {} });
        }
        const before = await snapshot(workspace.root);
        await expect(command.parseAsync(["node", "mono", generator.verb, "--packages"])).rejects.toMatchObject({
            code: "commander.optionMissingArgument",
        });
        expect(await snapshot(workspace.root)).toEqual(before);
    });
});
