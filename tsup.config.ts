import { defineConfig } from "tsup";

// Bundle everything except peer deps
const noExternal = [/^(?!@vue\/compiler-sfc)/];
const external = [/@vue\/compiler-sfc/];

// CJS deps (commander, etc.) use require() which doesn't exist in ESM.
// Inject createRequire so esbuild's CJS interop shim works at runtime.
const esmBanner = {
    js: `import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);`,
};

export default defineConfig([
    // CLI binary — fully bundled ESM
    {
        entry: { cli: "src/cli.ts" },
        format: ["esm"],
        platform: "node",
        noExternal,
        external,
        banner: esmBanner,
        treeshake: true,
        splitting: false,
        clean: true,
    },
    // Library API — ESM
    {
        entry: { index: "src/index.ts" },
        format: ["esm"],
        platform: "node",
        noExternal,
        external,
        banner: esmBanner,
        treeshake: true,
        splitting: false,
        dts: true,
    },
    // Library API — CJS (no banner needed, require() is native)
    {
        entry: { index: "src/index.ts" },
        format: ["cjs"],
        platform: "node",
        noExternal,
        external,
        treeshake: true,
        splitting: false,
    },
]);
