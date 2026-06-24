# @titannio/webtoolkit-cli

Portable CLI tools for TypeScript monorepos and web projects.

## Installation

```bash
npm install -D @titannio/webtoolkit-cli
```

## Commands

```bash
webtoolkit clean --level cache --dry-run
webtoolkit clean --level deep
webtoolkit clean --level nuclear --no-store-prune --reinstall=never
webtoolkit check
webtoolkit build
webtoolkit test --filter backend
webtoolkit test-coverage
webtoolkit release-gate
webtoolkit validate
webtoolkit jsdoc-report
webtoolkit upgrade --verbose
webtoolkit performance-bundle-audit
webtoolkit dev-watch --apps=user,admin
webtoolkit dev-grid --dry-run
webtoolkit wait-service --url=http://localhost:3001
webtoolkit env-bootstrap
webtoolkit env-doctor
webtoolkit guard docs-inventory
webtoolkit run:customTask
```

Cleanup levels:

- `empty`: remove empty directories only.
- `cache`: remove cache and temporary artifacts.
- `deep`: remove cache and build artifacts without `node_modules`.
- `nuclear`: remove cache, build artifacts, `node_modules`, then optionally run package-manager cleanup/reinstall.

## Project Config

Create `.webtoolkit-cli/config.json` in the consuming project root when defaults need project-specific paths, package-manager behavior, or configured task recipes. The file must be valid JSON: no comments and no trailing commas.

Start with the smallest config that describes what is local to your project:

```json
{
  "packageManager": "pnpm",
  "cleaner": {
    "workspaceRootNames": ["apps", "packages"],
    "protectedRootNames": ["apps", "scripts"],
    "levels": {
      "deep": {
        "removableSpecificFiles": ["apps/frontend-user/src/setup-env.js"]
      },
      "nuclear": {
        "removableSpecificFiles": ["apps/frontend-user/src/setup-env.js"]
      }
    }
  },
  "tasks": {
    "check": {
      "title": "Project checks",
      "steps": [
        {
          "label": "TypeScript",
          "command": "pnpm",
          "args": ["exec", "tsc", "--noEmit"]
        }
      ]
    }
  }
}
```

The config file is discovered by walking upward from the current working directory.

## Config Reference

Top-level fields:

- `packageManager`: command used for package-manager operations and task steps, usually `pnpm`, `npm`, or `yarn`.
- `cleaner`: optional cleanup behavior overrides.
- `tasks`: named recipes used by generic task commands such as `webtoolkit check`, `webtoolkit build`, and `webtoolkit run:<name>`.
- `repoCheck`: repository quality check steps used by `webtoolkit check`.
- `workspaceTests`: workspace targets used by `webtoolkit test`, `webtoolkit test-coverage`, and `webtoolkit workspace-test`.
- `releaseGate`: named critical stages used by `webtoolkit release-gate`.
- `validate`: ordered validation steps used by `webtoolkit validate`.
- `jsdocReport`: paths and rules used by `webtoolkit jsdoc-report`.
- `bundleAudit`: frontend build directories used by `webtoolkit performance-bundle-audit`.
- `upgrade`: dependency upgrade policy used by `webtoolkit upgrade`.
- `devWatch`: dev app ports and package filters used by `webtoolkit dev-watch`.
- `devGrid`: terminal panes used by `webtoolkit dev-grid`.
- `environment`: Node/Corepack/package-manager policy used by `webtoolkit env-bootstrap` and `webtoolkit env-doctor`.

Cleaner fields:

- `workspaceRootNames`: directory names whose direct children are package/app roots. With `["apps", "packages"]`, paths like `apps/api` and `packages/core` are workspace roots.
- `protectedRootNames`: top-level directories that must not be removed just because they are empty.
- `skipEmptyDirNames`: directory names skipped while removing empty directories.
- `skipArtifactDirNames`: directory names skipped while walking for artifacts.
- `levels`: per-cleanup-level overrides for `empty`, `cache`, `deep`, and `nuclear`.

Cleanup level fields:

- `label`: text printed in the summary.
- `removeEmptyDirs`: whether this level removes empty directories.
- `removableDirNames`: artifact directory names removable only at the repo root or workspace root.
- `removableFileNames`: exact file names to remove.
- `removableFileSuffixes`: file suffixes to remove.
- `removableFilePrefixes`: file prefixes to remove.
- `removableFilePatterns`: regex strings matched against file names.
- `removableSpecificFiles`: project-relative files to remove exactly.

Task fields:

- `title`: heading printed before the task runs.
- `failFast`: defaults to `true`; when enabled, later steps are skipped after a failure.
- `steps`: ordered commands to run.

Task step fields:

- `label`: human-readable step name.
- `builtinGuard`: optional builtin guard name for `repoCheck` steps. When present, `command` is not required.
- `command`: executable to spawn, such as `pnpm`, `node`, or `npm`.
- `args`: argument array; keep each shell token as a separate string.
- `cwd`: optional project-relative working directory for the step.
- `env`: optional environment variables for the step.
- `appendArgs`: when `true`, extra CLI arguments are appended to this step.
- `outputMode`: `inherit` by default; use `buffered` to print captured output only on failure.

Repo check fields:

- `title`: optional heading printed before checks run.
- `failFast`: defaults to `true`; when enabled, later checks are marked `SKIP` after a failure.
- `steps`: ordered task steps. The engine prints each step, tracks duration, and renders a final ASCII summary table.

Builtin guards:

- `any`
- `assert-no-tests-in-dist`
- `code-pattern`
- `dal-service-repository`
- `docs-inventory`
- `internal-link`
- `mojibake`
- `rebuild-preflight`
- `schema`
- `singleton-deps`
- `tsconfig`

Workspace test fields:

- `workspaces`: array of `{ "name", "package", "path" }`. `package` is the package-manager filter name; `path` is project-relative.
- `errorLogFile`: optional consolidated failure log path. Defaults to `tests_output_errors.log`.
- `testFilePattern`: optional regex string for test files. Defaults to `\\.(test|spec)\\.(ts|tsx|js|jsx)$`.
- `ignoreDirNames`: optional directory names skipped while counting test files.
- `maxFailureExcerptLines`: optional maximum number of lines written per failed workspace.

Release gate fields:

- `stages`: ordered stages. Each stage needs `name` and either `command`/`args`, `package`/`script`, or `package`/`files`.
- `package` plus `script` runs `packageManager --filter <package> run <script>`.
- `package` plus `files` runs `packageManager --filter <package> exec vitest run <files...>`.

Validation fields:

- `steps`: ordered task steps.
- `postSteps`: optional ordered task steps run after the main validation steps.

JSDoc report fields:

- `includePaths`: project-relative directories scanned by default.
- `excludePatterns`: regex strings skipped during scanning.
- `reportFile`: Markdown output path used with `--write`, `--report`, or an interactive confirmation.
- `maxLineLength`: maximum accepted JSDoc line length. `JSDOC_MAX_LINE_LENGTH` overrides this at runtime.
- `promptForReport`: when `true`, interactive terminals are asked before writing the Markdown report.

Bundle audit fields:

- `appDirs`: project-relative frontend app directories. Each app is expected to have `dist/assets`.
- `top`: number of largest assets printed by default.
- `rawWarningBytes`: raw byte threshold for warning markers.

Upgrade fields:

- `defaultCooldownDays`: release-age cooldown used unless `--no-cooldown` or `--days=N` is passed.
- `protectedOverridesFile`: project-relative YAML file with top-level `overrides`, usually `pnpm-workspace.yaml`.
- `protectedDependencyUpstreamHints`: map of protected package names to upstream packages that should be reviewed before isolated upgrades.
- `singletonGuardCommand`: optional task step run after protected singleton upgrades.
- The final upgrade summary reports packages that were not updated and groups them by the deciding filter, such as `Cooldown`, `Major`, or `Protected singleton`.

Dev watch fields:

- `apps`: map of app keys to `{ "displayName", "port", "filter", "color" }`. `filter` is required for watch mode.
- `defaultApps`: app keys used when `--apps` is omitted.
- `backendApp`: optional app key used by `--include-backend`.
- `host`: optional host used for port checks. Defaults to `127.0.0.1`.
- `backendPortCleanupGraceMs`: optional wait after killing a stale backend listener.

Dev grid fields:

- `panes`: ordered terminal panes with `title`, `command`, and optional `silentCommand`.
- `maxPanels`: optional positive integer. When defined, limits how many configured panes are opened.
- each pane can optionally define:
  - `fontSize`: positive integer font size for that pane. The CLI applies it through a temporary Windows Terminal fragment profile.
  - `fullWidth`: when `true`, forces the pane to occupy a full-width row.
- `fallbackScript` and `silentFallbackScript`: package scripts used when Windows Terminal is unavailable.
- `preflightCommand`: optional task step run before opening the grid.

Environment fields:

- `requiredNodeMajor`: expected Node major version.
- `corepackHome`: project-relative Corepack home directory.

## Common Config Patterns

Minimal project with only cleaner defaults:

```json
{
  "packageManager": "pnpm"
}
```

Monorepo with apps and packages:

```json
{
  "packageManager": "pnpm",
  "cleaner": {
    "workspaceRootNames": ["apps", "packages"],
    "protectedRootNames": ["apps", "packages", "scripts"]
  }
}
```

Project-specific generated files:

```json
{
  "cleaner": {
    "levels": {
      "deep": {
        "removableSpecificFiles": ["src/generated/env.d.ts"]
      },
      "nuclear": {
        "removableSpecificFiles": ["src/generated/env.d.ts"]
      }
    }
  }
}
```

Task that forwards extra arguments:

```json
{
  "tasks": {
    "test": {
      "title": "Project tests",
      "steps": [
        {
          "label": "Vitest",
          "command": "pnpm",
          "args": ["exec", "vitest", "run"],
          "appendArgs": true
        }
      ]
    }
  }
}
```

Then run:

```bash
webtoolkit test -- --filter auth
```

The separator `--` is optional but recommended when forwarding arguments through package scripts.

Repo check engine:

```json
{
  "repoCheck": {
    "title": "Project quality checks",
    "failFast": true,
    "steps": [
      {
        "label": "TypeScript Guard",
        "builtinGuard": "tsconfig"
      },
      {
        "label": "Architecture Lint",
        "command": "pnpm",
        "args": ["exec", "depcruise", "src", "--config", ".dependency-cruiser.cjs"]
      }
    ]
  }
}
```

Workspace test engine:

```json
{
  "workspaceTests": {
    "errorLogFile": "tests_output_errors.log",
    "workspaces": [
      { "name": "Core", "package": "@acme/core", "path": "packages/core" },
      { "name": "Backend", "package": "@acme/backend", "path": "apps/backend" }
    ]
  }
}
```

Use package scripts inside each workspace:

```json
{
  "scripts": {
    "test": "webtoolkit workspace-test test",
    "test:coverage": "webtoolkit workspace-test test:coverage"
  }
}
```

Release gate engine:

```json
{
  "releaseGate": {
    "stages": [
      { "name": "core-contracts", "package": "@acme/core", "script": "test:coverage" },
      {
        "name": "backend-critical",
        "package": "@acme/backend",
        "files": ["tests/integration/auth.spec.ts"]
      }
    ]
  }
}
```

JSDoc, bundle audit, and upgrade engines:

```json
{
  "jsdocReport": {
    "includePaths": ["apps/backend", "packages/core"],
    "excludePatterns": ["node_modules", "dist", "\\.test\\.", "\\.spec\\."],
    "reportFile": "temp_jsdocs_check.md",
    "maxLineLength": 250,
    "promptForReport": true
  },
  "bundleAudit": {
    "appDirs": ["apps/frontend"],
    "top": 20,
    "rawWarningBytes": 1000000
  },
  "upgrade": {
    "defaultCooldownDays": 7,
    "protectedOverridesFile": "pnpm-workspace.yaml",
    "protectedDependencyUpstreamHints": {
      "zod": ["@acme/shared-utils"]
    },
    "singletonGuardCommand": {
      "label": "Singleton Guard",
      "command": "pnpm",
      "args": ["exec", "tsx", "scripts/guards/singleton-deps.ts"]
    }
  }
}
```

Dev and environment engines:

```json
{
  "devWatch": {
    "host": "127.0.0.1",
    "backendApp": "backend",
    "defaultApps": ["user"],
    "apps": {
      "backend": { "displayName": "Backend", "port": 3001 },
      "user": {
        "displayName": "Frontend User",
        "filter": "@acme/frontend-user",
        "port": 3002
      }
    }
  },
  "devGrid": {
    "fallbackScript": "dev:concurrent",
    "silentFallbackScript": "dev:concurrent:silent",
    "preflightCommand": {
      "label": "DEV port preflight",
      "command": "webtoolkit",
      "args": ["dev-watch", "--check-only", "--include-backend"]
    },
    "panes": [
      {
        "title": "FRONTEND USER",
        "command": "pnpm run dev:frontend-user",
        "silentCommand": "pnpm run dev:frontend-user:silent",
        "fontSize": 15
      },
      {
        "title": "BACKEND",
        "command": "pnpm run dev:backend",
        "fullWidth": true
      }
    ]
  },
  "environment": {
    "requiredNodeMajor": 25,
    "corepackHome": ".corepack"
  }
}
```

Command resolution:

- When a native top-level config block exists, the matching command uses the CLI engine: `repoCheck` for `check`; `workspaceTests` for `test`, `test-coverage`, and `workspace-test`; `releaseGate` for `release-gate`; `validate` for `validate`; `jsdocReport` for `jsdoc-report`; `bundleAudit` for `performance-bundle-audit`; `upgrade` for `upgrade`; `devWatch` for `dev-watch`; `devGrid` for `dev-grid`; `environment` for `env-bootstrap` and `env-doctor`.
- Without the native block, public task commands fall back to configured task names:

- `webtoolkit build` -> `tasks.build`
- `webtoolkit test` -> `tasks.test`
- `webtoolkit test-coverage` -> `tasks.testCoverage`
- `webtoolkit release-gate` -> `tasks.releaseGate`
- `webtoolkit validate` -> `tasks.validate`
- `webtoolkit jsdoc-report` -> `tasks.jsdocReport`
- `webtoolkit upgrade` -> `tasks.upgrade`
- `webtoolkit performance-bundle-audit` -> `tasks.performanceBundleAudit`
- `webtoolkit run:<name>` -> `tasks.<name>`

## Avoiding Config Mistakes

- Use JSON arrays for `args`; do not write a whole command line as one string.
- Use project-relative paths in config. Absolute paths make the config machine-specific.
- Put generated-file cleanup in both `deep` and `nuclear` if both levels should remove it.
- Only override `removableDirNames` when you want to replace the default artifact directory list.
- Prefer `webtoolkit <task> --help` before running a newly configured task; it prints the resolved step list.
- Always test cleanup with `--dry-run` before running a destructive level.
