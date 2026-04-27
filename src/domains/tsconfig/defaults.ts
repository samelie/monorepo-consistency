/**
 * Internalized tsconfig defaults — replaces packages/config/*.tsconfig.json chain
 *
 * Merge order for web/node:
 *   1. SUPERBASE + BASE (include/exclude/watchOptions)
 *   2. schema.tsconfig.base (consumer base overrides)
 *   3. Type defaults (WEB or NODE)
 *   4. schema.tsconfig.web or .node (consumer type overrides)
 *   5. Local stub file (web.tsconfig.json)
 *
 * Builder is standalone (no superbase/base inheritance).
 */

// superbase.tsconfig.json
export const SUPERBASE_COMPILER_OPTIONS = {
    resolveJsonModule: true,
    strictNullChecks: true,
    esModuleInterop: true,
    verbatimModuleSyntax: true,
    skipDefaultLibCheck: true,
    exactOptionalPropertyTypes: false,
    noUncheckedIndexedAccess: true,
    noErrorTruncation: true,
    traceResolution: false,
    noPropertyAccessFromIndexSignature: false,
    target: "ESNext",
    useDefineForClassFields: true,
    module: "ESNext",
    lib: ["ES2022", "DOM", "DOM.Iterable", "esnext", "esnext.asynciterable"],
    skipLibCheck: true,
    moduleResolution: "bundler",
    allowImportingTsExtensions: false,
    isolatedModules: true,
    moduleDetection: "force",
    noEmit: false,
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true,
    noUncheckedSideEffectImports: true,
    erasableSyntaxOnly: true,
} as const satisfies Record<string, unknown>;

// base.tsconfig.json
export const BASE_INCLUDE = ["src"] as const;
export const BASE_EXCLUDE = ["node_modules", "dist", "build"] as const;
export const BASE_WATCH_OPTIONS = {
    excludeDirectories: ["**/node_modules", "build", "dist"],
    fallbackPolling: "dynamicPriority",
    synchronousWatchDirectory: true,
    watchDirectory: "UseFsEvents",
    watchFile: "UseFsEventsOnParentDirectory",
} as const;

// web.tsconfig.json
export const WEB_COMPILER_OPTIONS = {
    types: ["vite/client", "vitest/globals"],
    lib: ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
} as const;

// node.tsconfig.json
export const NODE_COMPILER_OPTIONS = {
    types: ["node"],
    lib: ["ESNext"],
    moduleDetection: "force",
    module: "ESNext",
    moduleResolution: "bundler",
} as const;

// builder.tsconfig.json (standalone — no superbase/base)
export const BUILDER_COMPILER_OPTIONS = {
    composite: true,
    noEmit: false,
    skipLibCheck: true,
    target: "ES2020",
    module: "ESNext",
    moduleResolution: "bundler",
    allowSyntheticDefaultImports: true,
} as const;

// tsconfig.typecheck.json
export const TYPECHECK_COMPILER_OPTIONS = {
    noEmit: true,
    composite: false,
    declaration: false,
    declarationDir: null,
    emitDeclarationOnly: false,
    skipLibCheck: true,
} as const;
