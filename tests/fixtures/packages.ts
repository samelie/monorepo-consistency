export const validPackage = {
    name: "@test/valid-package",
    version: "1.0.0",
    license: "MIT",
    type: "module",
    scripts: {
        test: "vitest",
        lint: "eslint .",
        types: "tsc --noEmit",
    },
    dependencies: {
        zod: "^4.0.0",
    },
    devDependencies: {
        vitest: "^2.0.0",
        typescript: "^5.0.0",
    },
};

export const packageMissingScripts = {
    name: "@test/missing-scripts",
    version: "1.0.0",
    type: "module",
    scripts: {
        // Missing required scripts: test, lint, types
    },
    dependencies: {},
};

export const packageWithWrongScripts = {
    name: "@test/wrong-scripts",
    version: "1.0.0",
    scripts: {
        test: "jest", // Should be "vitest"
        lint: "eslint .", // Correct
        types: "tsc", // Should be "tsc --noEmit"
    },
};

export const packageWithForbiddenScripts = {
    name: "@test/forbidden-scripts",
    version: "1.0.0",
    scripts: {
        test: "vitest",
        postinstall: "echo 'forbidden'", // Forbidden script
        prepare: "husky install", // Forbidden script
    },
};

export const packageMissingFields = {
    name: "@test/missing-fields",
    version: "1.0.0",
    // Missing: license, type
    scripts: {
        test: "vitest",
    },
};

export const packageWithForbiddenFields = {
    name: "@test/forbidden-fields",
    version: "1.0.0",
    license: "MIT",
    publishConfig: {}, // Forbidden field
    bundleDependencies: [], // Forbidden field
};

export const packageWithDifferentLicense = {
    name: "@test/different-license",
    version: "1.0.0",
    license: "Apache-2.0", // Different from MIT
    scripts: {
        test: "vitest",
    },
};

export const packageWithoutEngines = {
    name: "@test/no-engines",
    version: "1.0.0",
    license: "MIT",
    // Missing engines field
};

export const packageWithEngines = {
    name: "@test/with-engines",
    version: "1.0.0",
    license: "MIT",
    engines: {
        node: ">= 20",
        pnpm: ">= 9",
    },
};
