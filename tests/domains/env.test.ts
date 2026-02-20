import type { TempWorkspace } from "../helpers/workspace.js";
import { afterEach, describe, expect, it } from "vitest";
// eslint-disable-next-line rad/no-incorrect-pkg-imports
import { envHandler } from "../../src/index.js";
import { createTempWorkspace } from "../helpers/workspace.js";

describe("env domain", () => {
    let workspace: TempWorkspace;

    afterEach(async () => {
        if (workspace) {
            await workspace.cleanup();
        }
    });

    describe("encode", () => {
        it("should encode file content to base64", async () => {
            workspace = await createTempWorkspace({
                files: {
                    "test.env": "SECRET_KEY=abc123\nDB_URL=postgres://localhost",
                },
            });

            const encoded = await envHandler.encode({
                filePath: workspace.path("test.env"),
            });

            const expected = Buffer.from(
                "SECRET_KEY=abc123\nDB_URL=postgres://localhost",
            ).toString("base64");
            expect(encoded).toBe(expected);
        });

        it("should encode empty file", async () => {
            workspace = await createTempWorkspace({
                files: {
                    "empty.env": "",
                },
            });

            const encoded = await envHandler.encode({
                filePath: workspace.path("empty.env"),
            });

            expect(encoded).toBe(Buffer.from("").toString("base64"));
        });

        it("should encode file with special characters", async () => {
            const content = "KEY=\"value with spaces\"\nUNICODE=\u00E9\u00E8\u00EA";
            workspace = await createTempWorkspace({
                files: {
                    "special.env": content,
                },
            });

            const encoded = await envHandler.encode({
                filePath: workspace.path("special.env"),
            });

            const decoded = Buffer.from(encoded, "base64").toString("utf-8");
            expect(decoded).toBe(content);
        });

        it("should encode multiline content", async () => {
            const content = "LINE1=value1\nLINE2=value2\nLINE3=value3\n";
            workspace = await createTempWorkspace({
                files: {
                    "multi.env": content,
                },
            });

            const encoded = await envHandler.encode({
                filePath: workspace.path("multi.env"),
            });

            expect(Buffer.from(encoded, "base64").toString("utf-8")).toBe(
                content,
            );
        });
    });

    describe("decode", () => {
        it("should decode base64 to string", async () => {
            const original = "SECRET_KEY=abc123\nDB_URL=postgres://localhost";
            const encoded = Buffer.from(original).toString("base64");

            const decoded = await envHandler.decode({ encoded });
            expect(decoded).toBe(original);
        });

        it("should decode and write to output file", async () => {
            workspace = await createTempWorkspace();

            const original = "API_KEY=secret-value";
            const encoded = Buffer.from(original).toString("base64");

            await envHandler.decode({
                encoded,
                output: workspace.path("output.env"),
            });

            const written = await workspace.readFile("output.env");
            expect(written).toBe(original);
        });

        it("should decode empty base64", async () => {
            const encoded = Buffer.from("").toString("base64");
            const decoded = await envHandler.decode({ encoded });
            expect(decoded).toBe("");
        });

        it("should handle round-trip encode/decode", async () => {
            const original = "COMPLEX_VAR=some/path?query=1&other=2\nNESTED={\"key\":\"value\"}";
            workspace = await createTempWorkspace({
                files: {
                    "round-trip.env": original,
                },
            });

            const encoded = await envHandler.encode({
                filePath: workspace.path("round-trip.env"),
            });

            const decoded = await envHandler.decode({ encoded });
            expect(decoded).toBe(original);
        });
    });
});
