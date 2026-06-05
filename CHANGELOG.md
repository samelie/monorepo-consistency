# @adddog/monorepo-consistency

## 0.2.0

### Minor Changes

- 2ff10e2: Required-file enforcement via new `files` config section. Every package must have an eslint config (`eslint.config.mjs`/`.ts` containing `@adddog/eslint`) and a tsconfig marker (`web`/`node`/`builder.tsconfig.json`) at the package root. `mono config check` reports `missing-*`, `invalid-*`, and `unmanaged-tsconfig-marker` (handwritten tsconfig.json without marker — migration backlog, never auto-fixed). `mono config fix --add-missing` creates missing files: eslint configs from the schema default snippet, markers as `{}` with a web/node dependency heuristic. Rules fully configurable (anyOf, createAs, defaultContent, mustContain, severity, ignorePackages). Also adds `--json` to `mono config check`.

### Patch Changes

- d9bbcc3: Hardening from the required-files rollout: `DEFAULT_ESLINT_CONFIG_CONTENT` now ends with a semicolon (created configs no longer fail the shared style/semi rule); workspace package discovery skips package.json under dist/, build/, and node_modules/ (build artifacts no longer register as workspace packages); new `orphaned-typecheck` check flags tsconfig.typecheck.json without a tsconfig.json.

## 0.1.1

### Patch Changes

- 0a4ac24: Remove "private" from required package.json fields (allows packages to opt out for npm publishing).

## 0.1.0

### Minor Changes

- 090d904: Replace lodash/merge with array-replace + null-deletion merge for tsconfig generation.
  Arrays in overrides now fully replace (not index-merge), null values delete keys from output.
  Add DOM lib to trivial-user-agent-detector for TS6 compatibility.
