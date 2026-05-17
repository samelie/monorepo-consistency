---
name: monorepo-consistency
description: "Use when maintaining monorepo consistency — tsconfig generation, package.json hygiene, dependency checks, circular dependency detection, knip config, env encoding, build ordering, or CI mirroring. Triggers: mono, monorepo consistency, tsconfig generate, dependency check, circular deps, knip config, package.json check, env encode, build order, ci mirror, publish init. CLI binary: `mono` (dev: `pnpm -F @adddog/monorepo-consistency dev`). Do NOT use for pnpm workspace lint/types/test — those use /pnpm-workspace-filter."
---

# @adddog/monorepo-consistency Skill

Monorepo consistency and maintenance toolkit. CLI binary: `mono`. Package: `@adddog/monorepo-consistency`.

## Quick Reference

| Task | Command |
|------|---------|
| Init config | `mono init` or `mono init --defaults` |
| Generate tsconfigs | `mono tsconfig generate` |
| Check tsconfigs | `mono tsconfig check` (add `--fix` to auto-fix) |
| Validate tsconfigs | `mono tsconfig validate` (add `--strict`) |
| Check package.json | `mono packagejson check` |
| Check deps | `mono deps check --all` |
| Update deps | `mono deps update -i` |
| Detect circular deps | `mono circular` |
| Generate knip configs | `mono knip generate` |
| Encode .env | `mono env encode .env --copy` |
| Preview build order | `mono build --dry-run` |
| Mirror CI locally | `mono ci mirror` |
| Init publish repo | `mono publish init my-pkg packages/my-pkg` |
| Dump config | `mono config show` |
| Generate JSON schema | `mono schema` |

## Global Options

```
--cwd <path>        Working directory (default: cwd)
-c, --config <path> Config file path (auto-discovers if omitted)
--verbose           Verbose output
--silent            Suppress output
--no-color          Disable colors
```

## Dev Mode

```bash
pnpm -F @adddog/monorepo-consistency dev -- <command> [options]
```

## Architecture

```
src/
├── cli.ts              # Commander program, 12 subcommands
├── commands/           # Command definitions (init, tsconfig, deps, etc.)
├── domains/            # Domain logic per feature
│   ├── tsconfig/       # Generate/check/validate tsconfigs
│   ├── deps/           # Dependency checking via taze
│   ├── circular/       # Circular dep detection (madge, dpdm, inter-package)
│   ├── knip/           # Knip config generation with detectors
│   ├── packagejson/    # package.json hygiene
│   ├── env/            # .env encoding
│   ├── build/          # Build ordering
│   ├── publish/        # Public repo publishing
│   └── config/         # Config management
├── runners/            # External tool wrappers (madge, dpdm, taze, tsconfig)
├── config/             # Config schema (Zod), loader, JSON schema gen
├── utils/              # Workspace discovery, logger
└── types/              # Shared types
```

## Key Patterns

### tsconfig Generation
- Reads centralized configs from `packages/config/` (base, web, node, builder)
- Requires local marker files (`node.tsconfig.json`, `web.tsconfig.json`) in each package
- Filters `@domain/*` paths to only those matching package.json dependencies
- Generates `tsconfig.json` + `tsconfig.typecheck.json` per package
- **Never hand-edit generated tsconfigs** — re-run `mono tsconfig generate`

### Programmatic API
Package exports all domain handlers and tsconfig builders:
```typescript
import { tsconfigHandler, buildBaseConfig, defineKnipConfig } from "@adddog/monorepo-consistency";
```

### Config File
Auto-discovered up directory tree. Supports JSON/YAML. Generate with `mono init`.

## Common Workflows

| Scenario | Steps |
|----------|-------|
| New package | Create marker file → `mono tsconfig generate` → `mono packagejson check` |
| Dep update | `mono deps check --all` → `mono deps update -i` |
| Pre-CI check | `mono ci mirror` |
| Debug tsconfig | `mono tsconfig validate --strict` → check marker files → check `packages/config/` |
