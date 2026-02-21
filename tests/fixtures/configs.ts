import type { MonorepoConfig } from "@rad/..";

export const minimalConfig: Partial<MonorepoConfig> = {
    version: "1.0.0",
    deps: {
        checkUnused: true,
        checkMissing: true,
        checkVersionMismatch: true,
    },
};

export const scriptEnforcementConfig: Partial<MonorepoConfig> = {
    version: "1.0.0",
    packageJson: {
        scripts: {
            enforce: true,
            required: {
                test: "vitest",
                lint: "eslint .",
                types: "tsc --noEmit",
            },
            recommended: {
                "lint:fix": "eslint --fix .",
                "build": "tsup",
            },
            forbidden: ["postinstall", "prepare"],
            ignorePackages: ["@internal/*", "*-test"],
        },
        autoFix: {
            addMissingScripts: true,
            removeInvalidFields: true,
        },
    },
};

export const fieldEnforcementConfig: Partial<MonorepoConfig> = {
    version: "1.0.0",
    packageJson: {
        fields: {
            required: [
                "name",
                "version",
                { field: "license", default: "MIT" },
                { field: "type", default: "module" },
            ],
            forbidden: ["publishConfig", "bundleDependencies"],
        },
        autoFix: {
            addMissingScripts: false,
            removeInvalidFields: true,
        },
    },
};

export const consistencyConfig: Partial<MonorepoConfig> = {
    version: "1.0.0",
    packageJson: {
        consistency: {
            checkLicense: true,
            checkEngines: true,
        },
    },
};

export const fullConfig: Partial<MonorepoConfig> = {
    version: "1.0.0",
    packageJson: {
        scripts: {
            enforce: true,
            required: {
                test: "vitest",
                lint: "eslint .",
            },
            recommended: {
                build: "tsup",
            },
            forbidden: ["postinstall"],
            ignorePackages: ["@internal/*"],
        },
        fields: {
            required: ["name", "version", { field: "license", default: "MIT" }],
            forbidden: ["bundleDependencies"],
        },
        consistency: {
            checkLicense: true,
            checkEngines: true,
        },
        autoFix: {
            addMissingScripts: true,
            removeInvalidFields: true,
        },
    },
    deps: {
        taze: {
            runner: "npx",
        },
    },
};
