# @adddog/monorepo-consistency

## 0.1.1

### Patch Changes

- 0a4ac24: Remove "private" from required package.json fields (allows packages to opt out for npm publishing).

## 0.1.0

### Minor Changes

- 090d904: Replace lodash/merge with array-replace + null-deletion merge for tsconfig generation.
  Arrays in overrides now fully replace (not index-merge), null values delete keys from output.
  Add DOM lib to trivial-user-agent-detector for TS6 compatibility.
