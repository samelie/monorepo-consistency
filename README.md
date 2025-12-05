# @adddog/monorepo-consistency

A tool for maintaining consistency across a pnpm monorepo, including automated TypeScript configuration generation and package.json hygiene checks.

## Quick Start

Initialize a new configuration file:

```bash
# Interactive mode - prompts for common settings
mono init

# Use defaults - generates complete config without prompts
mono init --defaults

# Custom output location
mono init --output path/to/config.json

# Force overwrite existing config
mono init --force
```

The `init` command creates a complete `monorepo.config.json` file with sensible defaults for:
- Dependency management
- TypeScript configuration generation
- Package.json hygiene checks

## Commands

### Initialization

```bash
# Initialize configuration interactively
mono init

# Initialize with all defaults (no prompts)
mono init --defaults

# Specify output location
mono init --output custom-config.json

# Force overwrite existing configuration
mono init --force
```

**Interactive mode** asks for:
- Enable/disable TypeScript config generation
- Enable/disable package.json hygiene checks
- Enable/disable dependency checks
- Taze runner preference

**Defaults mode** creates a complete configuration with:
- All checks enabled
- Recommended scripts for build, lint, types, test
- Node >= 22, pnpm >= 10 engine requirements
- Private packages by default

### TypeScript Configuration Management

```bash
# Generate TypeScript configurations for all packages
mono tsconfig generate

# Generate with verbose output
mono tsconfig generate --verbose

# Generate only specific config types
mono tsconfig generate --type web
mono tsconfig generate --type node
mono tsconfig generate --type builder

# Dry run (preview without writing)
mono tsconfig generate --dry-run

# Force overwrite existing configs
mono tsconfig generate --force

# Check for configuration issues
mono tsconfig check

# Check and automatically fix issues
mono tsconfig check --fix

# Validate configurations
mono tsconfig validate

# Validate with strict rules
mono tsconfig validate --strict

# Validate specific files
mono tsconfig validate packages/shadcn-vue-design-system/tsconfig.json
```

## TypeScript Configuration Generation

### How It Works

The TypeScript configuration generator creates consistent `tsconfig.json` files across your monorepo by:

1. **Scanning for marker files** - Looks for `web.tsconfig.json`, `node.tsconfig.json`, or `builder.tsconfig.json` in package directories
2. **Merging configurations** - Combines base configs from `packages/config` with local overrides
3. **Filtering paths** - Removes unnecessary `compilerOptions.paths` based on actual package dependencies
4. **Writing output** - Generates final `tsconfig.json` and `tsconfig.typecheck.json` files

### Requirements

For the TypeScript generation to work, your monorepo needs:

#### 1. Centralized Configuration Package

A `packages/config` directory containing base TypeScript configurations:

```
packages/config/
├── base.tsconfig.json        # Base config with all compiler options and paths
├── web.tsconfig.json          # Web-specific config (extends base)
├── node.tsconfig.json         # Node-specific config (extends base)
├── builder.tsconfig.json      # Builder-specific config
└── superbase.tsconfig.json    # Additional base config (optional)
```

**Example `packages/config/base.tsconfig.json`:**
```json
{
  "extends": "./superbase.tsconfig.json",
  "compilerOptions": {
    "paths": {
      "@domain/env": ["./packages/env/src/index", "../env/src/index", ...],
      "@domain/logging": ["./packages/logging/src/index", ...],
      "@domain/config": ["./packages/config/src/index", ...],
      // ... all possible workspace packages
    }
  }
}
```

**Example `packages/config/web.tsconfig.json`:**
```json
{
  "extends": "./base.tsconfig.json",
  "compilerOptions": {
    "types": ["vite/client", "vitest/globals"],
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]
  }
}
```

**Example `packages/config/node.tsconfig.json`:**
```json
{
  "extends": "./base.tsconfig.json",
  "compilerOptions": {
    "types": ["node"],
    "lib": ["ESNext"],
    "moduleDetection": "force"
  }
}
```

#### 2. Local Marker Files (REQUIRED)

**⚠️ CRITICAL PREREQUISITE**: Each package **MUST** have a marker file for the generator to work.

The presence of `web.tsconfig.json` or `node.tsconfig.json` in a package directory tells the generator:
1. **That this package needs a generated tsconfig.json**
2. **What type of config to generate** (web or node)
3. **What local overrides to apply**

Without these marker files, the generator will skip the package entirely.

##### Web Packages (Vite, Vue, React, etc.)

Create `web.tsconfig.json` in your package root:

```json
// packages/shadcn-vue-design-system/web.tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "src*": ["./src/*"]
    }
  }
}
```

**What this does:**
- Signals this is a web package
- Merges with `packages/config/web.tsconfig.json` (which extends `base.tsconfig.json`)
- Adds local `src*` path mapping
- Results in a tsconfig with DOM types, Vite types, etc.

##### Node Packages (Backend, Scripts, CLI tools)

Create `node.tsconfig.json` in your package root:

```json
// park-app/apps/backend/node.tsconfig.json
{
  // Empty is fine - just needs to exist as a marker
}
```

**Or with local overrides:**

```json
// park-app/apps/backend/node.tsconfig.json
{
  "compilerOptions": {
    "types": ["node", "jest"]
  }
}
```

**What this does:**
- Signals this is a Node.js package
- Merges with `packages/config/node.tsconfig.json` (which extends `base.tsconfig.json`)
- Results in a tsconfig with Node types, ESNext lib, etc.

##### The Marker File Pattern

```
your-package/
├── package.json                 # Contains dependencies
├── web.tsconfig.json           # ← MARKER FILE (web) - required for generation
├── tsconfig.json               # ← GENERATED (do not edit manually)
├── tsconfig.typecheck.json     # ← GENERATED (do not edit manually)
└── src/
    └── index.ts
```

**Key points:**
1. **Marker files are checked into source control** - They define the package's config type
2. **Generated files can be gitignored** - They're regenerated on demand
3. **Only one marker file per package** - Use either `web.tsconfig.json` OR `node.tsconfig.json`
4. **Marker files can be minimal** - Even an empty `{}` works

##### When to Use Which Marker File

| Package Type | Marker File | Example Packages |
|--------------|-------------|------------------|
| Frontend (Vite/Vue/React) | `web.tsconfig.json` | `packages/shadcn-vue-design-system`, `park-app/apps/webui` |
| Backend (Fastify/Express) | `node.tsconfig.json` | `park-app/apps/backend`, `ai-agents` |
| CLI Tools | `node.tsconfig.json` | `monorepo-scripts`, `kubernetes/kubectl-debug` |
| Shared Libraries (Node) | `node.tsconfig.json` | `packages/logging`, `packages/env` |
| Shared Libraries (Web) | `web.tsconfig.json` | `packages/design-tokens`, `packages/map2d-vue` |

#### 3. Package Dependencies

The generator reads `package.json` to filter `compilerOptions.paths`:

```json
{
  "name": "@domain/design-system",
  "dependencies": {
    "@domain/design-tokens": "workspace:*"
  },
  "devDependencies": {
    "@domain/config": "workspace:*",
    "@domain/eslint": "workspace:*"
  }
}
```

**Result:** Generated `tsconfig.json` will only include paths for:
- `@domain/design-tokens`
- `@domain/config`
- `@domain/eslint`
- Non-scoped paths (like `src*`)

All other `@domain/*` or `@park-app/*` paths from the base config are filtered out.

### Configuration Search Strategy

The generator searches for base configs in these relative locations from each package:

```
../config
../../config
../packages/config
../../packages/config
../../../packages/config
../../../../packages/config
```

This allows for both:
- Monorepo-wide configs at `packages/config/`
- Sub-project configs at `park-app/packages/config/`, `dnd-3.5/packages/config/`, etc.

### Generated Files

For each package with a marker file, generates:

1. **`tsconfig.json`** - Merged and filtered configuration
   - Combines base config + local overrides
   - Filters `compilerOptions.paths` to only dependencies
   - Removes `extends` field (fully resolved)

2. **`tsconfig.typecheck.json`** - Type-checking configuration
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "noEmit": true,
       "composite": false,
       "skipLibCheck": true
     }
   }
   ```

### Path Filtering Logic

The generator automatically filters `compilerOptions.paths` to include only:

1. **Packages in dependencies/devDependencies** from `package.json`
2. **Non-scoped paths** (paths not starting with `@`)

**Example:**

Base config has 15+ `@domain/*` paths, but package only uses 3:

```json
// package.json
{
  "dependencies": { "@domain/design-tokens": "workspace:*" },
  "devDependencies": {
    "@domain/config": "workspace:*",
    "@domain/eslint": "workspace:*"
  }
}

// Generated tsconfig.json (filtered)
{
  "compilerOptions": {
    "paths": {
      "@domain/design-tokens/*": [...],
      "@domain/config": [...],
      "@domain/eslint": [...],
      "src*": ["./src/*"]  // Non-scoped, always kept
    }
  }
}
```

### Complete Generation Example

Here's a real-world example showing what gets generated:

#### Input Files

**`packages/shadcn-vue-design-system/package.json`:**
```json
{
  "name": "@domain/design-system",
  "dependencies": {
    "@domain/design-tokens": "workspace:*"
  },
  "devDependencies": {
    "@domain/config": "workspace:*",
    "@domain/eslint": "workspace:*"
  }
}
```

**`packages/shadcn-vue-design-system/web.tsconfig.json`** (marker file):
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "src*": ["./src/*"]
    }
  }
}
```

**`packages/config/base.tsconfig.json`** (15+ paths):
```json
{
  "compilerOptions": {
    "paths": {
      "@domain/env": ["./packages/env/src/index", "../env/src/index", ...],
      "@domain/vite": ["./packages/vite/src/index", ...],
      "@domain/logging": ["./packages/logging/src/index", ...],
      "@domain/config": ["./packages/config/src/index", ...],
      "@domain/design-tokens/*": ["./packages/design-tokens/*", ...],
      "@domain/eslint": ["./packages/eslint", ...],
      "@domain/type-utils": ["./packages/type-utils/src/index", ...],
      "@domain/map2d/*": ["./packages/map2d/src/*", ...],
      "@domain/worker-streams": ["./packages/worker-streams/src/index", ...],
      // ... 6 more @domain/* paths
    }
  }
}
```

**`packages/config/web.tsconfig.json`:**
```json
{
  "extends": "./base.tsconfig.json",
  "compilerOptions": {
    "types": ["vite/client", "vitest/globals"],
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]
  }
}
```

#### Generated Output

**`packages/shadcn-vue-design-system/tsconfig.json`** (auto-generated):
```json
{
  "compilerOptions": {
    "resolveJsonModule": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "target": "ESNext",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "moduleResolution": "bundler",
    "strict": true,
    "paths": {
      "@domain/config": [
        "./packages/config/src/index",
        "../config/src/index",
        "../packages/config/src/index",
        "../../packages/config/src/index",
        "../../../packages/config/src/index"
      ],
      "@domain/design-tokens/*": [
        "./packages/design-tokens/*",
        "../design-tokens/*",
        "../packages/design-tokens/*",
        "../../packages/design-tokens/*",
        "../../../packages/design-tokens/*"
      ],
      "@domain/eslint": [
        "./packages/eslint",
        "../eslint",
        "../packages/eslint",
        "../../packages/eslint",
        "../../../packages/eslint"
      ],
      "src*": ["./src/*"]
    },
    "types": ["vite/client", "vitest/globals"],
    "baseUrl": "."
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "build"]
}
```

**Notice:**
- ✅ All compiler options from `base.tsconfig.json` merged
- ✅ Web-specific settings from `web.tsconfig.json` merged
- ✅ Local `src*` path from marker file included
- ✅ Only 3 `@domain/*` paths (matching package.json dependencies)
- ❌ 12+ other `@domain/*` paths filtered out

**`packages/shadcn-vue-design-system/tsconfig.typecheck.json`** (auto-generated):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "declarationDir": null,
    "emitDeclarationOnly": false,
    "skipLibCheck": true
  }
}
```

## Configuration

You can configure the tool's behavior via a `monorepo.config.json` file:

```json
{
  "version": "1.0.0",
  "tsconfig": {
    "enabled": true,
    "types": ["web", "node", "builder"],
    "configLocations": [
      "../config",
      "../../config",
      "../packages/config",
      "../../packages/config"
    ],
    "generateTypecheck": true,
    "filterPathsByDependencies": true,
    "excludePatterns": [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**"
    ],
    "rootConfigDir": "packages/config",
    "validation": {
      "checkMissing": true,
      "checkExtends": true,
      "checkConsistency": true,
      "strictMode": false
    }
  },
  "packageJson": {
    "enabled": true,
    "scripts": {
      "enforce": false,
      "required": {
        "build": "unbuild",
        "lint": "eslint .",
        "types": "tsc -p tsconfig.typecheck.json"
      }
    },
    "fields": {
      "required": ["name", "version"]
    }
  },
  "deps": {
    "checkUnused": true,
    "checkMissing": true,
    "checkVersionMismatch": true
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable TypeScript config generation |
| `types` | array | `['web', 'node', 'builder']` | Config types to generate |
| `configLocations` | array | See config | Possible locations for app-specific configs |
| `generateTypecheck` | boolean | `true` | Generate tsconfig.typecheck.json files |
| `filterPathsByDependencies` | boolean | `true` | Filter paths by actual dependencies |
| `excludePatterns` | array | node_modules, dist, build | Patterns to exclude when scanning |
| `rootConfigDir` | string | `'packages/config'` | Root config directory to skip |
| `validation.checkMissing` | boolean | `true` | Check for missing tsconfig.json files |
| `validation.checkExtends` | boolean | `true` | Validate extends chains |
| `validation.checkConsistency` | boolean | `true` | Check compiler options consistency |
| `validation.strictMode` | boolean | `false` | Enforce strict validation rules |

## Health Checks

### Check Command

The `check` command scans your monorepo for TypeScript configuration issues:

```bash
mono tsconfig check
```

**What it checks:**
- ✅ Missing `tsconfig.json` files (when marker files exist)
- ✅ Missing `tsconfig.typecheck.json` files
- ✅ Broken extends chains
- ✅ Circular extends references

**Example output:**
```
✓ Checked 45 packages

Issues found:

MEDIUM:
  [missing-tsconfig] packages/new-feature/tsconfig.json: Package has base config but missing generated tsconfig.json
    Fix: Run: mono tsconfig generate

LOW:
  [missing-typecheck-config] packages/shadcn-vue-design-system/tsconfig.typecheck.json: Missing typecheck configuration
    Fix: Run: mono tsconfig generate

Summary: 2 issue(s) - Critical: 0, High: 0, Medium: 1, Low: 1
```

**Auto-fix mode:**
```bash
mono tsconfig check --fix
```

This will automatically regenerate configurations to fix issues.

### Validate Command

The `validate` command performs deeper validation of TypeScript configurations:

```bash
mono tsconfig validate
```

**What it validates:**
- ✅ JSON syntax correctness
- ✅ Extends chain validity
- ✅ Circular reference detection
- ✅ Missing compiler options (strict mode)
- ✅ Non-strict TypeScript settings (strict mode)

**Strict mode validation:**
```bash
mono tsconfig validate --strict
```

In strict mode, additional checks are performed:
- Validates that `compilerOptions` exists
- Checks that `strict: true` is set
- Reports missing critical compiler options

**Validate specific files:**
```bash
mono tsconfig validate packages/shadcn-vue-design-system/tsconfig.json park-app/apps/webui/tsconfig.json
```

## Practical Workflows

### Setting Up a New Package

1. **Create the marker file** based on package type:
   ```bash
   # For a web package
   echo '{"compilerOptions":{"baseUrl":".","paths":{"src*":["./src/*"]}}}' > web.tsconfig.json

   # For a node package
   echo '{}' > node.tsconfig.json
   ```

2. **Add dependencies** to `package.json`:
   ```json
   {
     "devDependencies": {
       "@domain/config": "workspace:*",
       "@domain/eslint": "workspace:*"
     }
   }
   ```

3. **Generate the config**:
   ```bash
   mono tsconfig generate --verbose
   ```

4. **Verify** the generated `tsconfig.json` only includes paths for your dependencies

### CI/CD Integration

Add TypeScript config health checks to your CI pipeline:

```yaml
# .github/workflows/ci.yml
- name: Check TypeScript configurations
  run: |
    mono tsconfig check
    mono tsconfig validate
```

Or use strict mode for production:

```yaml
- name: Validate TypeScript configurations (strict)
  run: mono tsconfig validate --strict
```

### Regular Maintenance

Run these commands periodically to keep configs healthy:

```bash
# Check for issues
mono tsconfig check

# Regenerate all configs
mono tsconfig generate --force

# Validate everything
mono tsconfig validate
```

### Adding a New Dependency

When you add a new workspace dependency:

```bash
# 1. Add to package.json
pnpm add -D @domain/logging

# 2. Regenerate configs to pick up the new path
mono tsconfig generate

# 3. The generated tsconfig.json now includes @domain/logging paths
```

### Debugging Generated Configs

```bash
# See exactly what's being generated
mono tsconfig generate --verbose

# Preview without writing files
mono tsconfig generate --dry-run --verbose

# Force regeneration if files seem stale
mono tsconfig generate --force

# Check what's wrong
mono tsconfig check --verbose

# Validate configurations
mono tsconfig validate --verbose
```

## Troubleshooting

### My package's tsconfig.json wasn't generated

**Check:**
1. ✅ Does the package have `web.tsconfig.json` OR `node.tsconfig.json`?
2. ✅ Does the package have a `package.json`?
3. ✅ Is there a `packages/config/` directory with base configs?

**Solution:** Add the appropriate marker file (`web.tsconfig.json` or `node.tsconfig.json`)

### The generated tsconfig.json has too many paths

**Symptom:** You see paths for packages you don't use

**Cause:** Those packages might be in your `dependencies` or `devDependencies`

**Solution:**
1. Check `package.json` - remove unused dependencies
2. Regenerate: `mono tsconfig generate`

### The generated tsconfig.json is missing a path I need

**Symptom:** Import fails but the package isn't in `compilerOptions.paths`

**Cause:** The package isn't in your `package.json` dependencies

**Solution:**
1. Add to `package.json`: `pnpm add @domain/missing-package`
2. Regenerate: `mono tsconfig generate`

### I want to customize my tsconfig.json

**DON'T:** Edit `tsconfig.json` directly (it gets overwritten)

**DO:** Add customizations to your marker file:

```json
// web.tsconfig.json or node.tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "src*": ["./src/*"],
      "@custom/alias": ["./src/custom"]
    },
    "types": ["vite/client", "custom-types"]
  },
  "include": ["src", "custom-dir"]
}
```

These overrides will be merged into the generated `tsconfig.json`.

### How do I add a new monorepo package to the base config?

When you create a new shared package like `@domain/new-package`:

1. **Add the path to `packages/config/base.tsconfig.json`**:
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@domain/new-package": [
           "./packages/new-package/src/index",
           "../new-package/src/index",
           "../packages/new-package/src/index",
           "../../packages/new-package/src/index",
           "../../../packages/new-package/src/index"
         ]
       }
     }
   }
   ```

2. **Regenerate all configs**:
   ```bash
   mono tsconfig generate
   ```

3. **The path will only appear** in packages that have `@domain/new-package` in their `package.json`

### Configuration is valid but TypeScript still has errors

**Symptom:** `mono tsconfig validate` passes but `tsc` reports errors

**Possible causes:**
1. **Extends chain is broken in a non-obvious way**
   - Run: `mono tsconfig check` to detect broken chains

2. **Paths are correct but files don't exist**
   - Verify the actual files exist at the paths specified

3. **Build order issues**
   - Some packages may need to be built before others can resolve types

4. **Stale configuration**
   - Try: `mono tsconfig generate --force`

## Dependency Management

### Upgrade a Single Dependency

Upgrade a specific dependency across all packages in the monorepo:

```bash
# Upgrade to latest major version (default)
mono deps upgrade typescript --major -w

# Upgrade to latest minor version
mono deps upgrade react --minor -w

# Upgrade to latest patch version
mono deps upgrade lodash --patch -w

# Preview without applying changes
mono deps upgrade zod --dry-run

# Upgrade and install
mono deps upgrade vitest --minor -w --install
```

**Options:**

| Option | Description |
|--------|-------------|
| `--major` | Allow major version upgrades (default) |
| `--minor` | Only minor version upgrades |
| `--patch` | Only patch version upgrades |
| `-w, --write` | Write changes to package.json files |
| `--install` | Run install after upgrading |
| `--dry-run` | Preview the command without executing |

### Update All Dependencies

```bash
# Interactive update mode
mono deps update -i

# Update all with major versions
mono deps update --major -w

# Preview available updates
mono deps preview

# Update specific packages
mono deps update --filter react vue
```

### Check Dependencies

```bash
# Check for dependency issues
mono deps check --all

# Check for unused dependencies
mono deps check --unused

# Check for version mismatches
mono deps check --mismatches
```

## Scripts

| Script | Description |
|--------|-------------|
| `build` | `unbuild` |
| `lint` | `eslint .` |
| `lint:fix` | `eslint --fix .` |
| `types` | `tsc -p tsconfig.typecheck.json` |

