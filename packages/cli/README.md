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
webtoolkit config --help documentation
webtoolkit config --help guards
webtoolkit config --json
webtoolkit config --json guards
webtoolkit guard documentation
webtoolkit guard repository-hygiene
webtoolkit guard package-surface
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

The CLI also exposes its complete configuration reference without requiring a config file:

```bash
webtoolkit config
webtoolkit config --help documentation
webtoolkit config --help guards
webtoolkit config --json
webtoolkit config --json documentation
webtoolkit config --json guards
```

`--json` emits JSON Schema for tools that need a machine-readable list of supported fields.

Every discovered config is validated before a configured command or guard
starts. Unknown fields, invalid regular expressions, paths that escape the
project, empty required scopes, unknown builtin names, and steps that define
both or neither `command` and `builtinGuard` are rejected with config paths in
the error. Configured scan directories must exist, be directories, and contain
at least one eligible file; this prevents a missing scope from producing a
false successful check.

## Config Reference

Top-level fields:

- `packageManager`: command used for package-manager operations and task steps, usually `pnpm`, `npm`, or `yarn`.
- `cleaner`: optional cleanup behavior overrides.
- `tasks`: named recipes used by generic task commands such as `webtoolkit check`, `webtoolkit build`, and `webtoolkit run:<name>`.
- `guards`: consumer-owned paths, targets, rules, and allowlists for configurable builtin guards.
- `documentation`: declarative Markdown, collection, paired-document, and coverage-inventory checks.
- `repoCheck`: repository quality check steps used by `webtoolkit check`.
- `workspaceTests`: workspace targets used by `webtoolkit test`, `webtoolkit test-coverage`, and `webtoolkit workspace-test`.
- `releaseGate`: named critical stages used by `webtoolkit release-gate`.
- `validate`: ordered validation steps used by `webtoolkit validate`.
- `jsdocReport`: paths and rules used by `webtoolkit jsdoc-report`.
- `bundleAudit`: frontend build directories, diagnostic thresholds, and blocking asset budgets used by `webtoolkit performance-bundle-audit`.
- `upgrade`: dependency upgrade policy used by `webtoolkit upgrade`.
- `devWatch`: dev app ports and package filters used by `webtoolkit dev-watch`.
- `devGrid`: terminal row layout used by `webtoolkit dev-grid`.
- `environment`: Node/Corepack/package-manager policy used by `webtoolkit env-bootstrap` and `webtoolkit env-doctor`.

Documentation fields:

- `files`: required glob patterns selecting Markdown files to inspect.
- `excludeDirectories`: optional directory names omitted from repository scanning.
- `checks`: optional `singleH1`, `headingOrder`, `localLinks`, and reachability rules. The first three default to `true`.
- `requiredFiles`: exact repository-relative files that must exist.
- `collections`: document globs with optional index, metadata, and paired-document rules.
- `inventories`: inventory documents and source globs that must be listed as inline-code paths.
- Paths and globs are repository-relative. Paired-document targets support `{basename}` and `{stem}`.
- Run `webtoolkit config --help documentation` or `webtoolkit config --json documentation` for the complete nested reference.

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
- `failFast`: defaults to `false`, so every independent check runs and all failures appear in one summary. Set it to `true` to mark later checks as `SKIP` after the first failure.
- `steps`: ordered task steps. The engine prints each step, tracks duration, and renders a final ASCII summary table.

Builtin guards:

- `any`
- `assert-no-tests-in-dist`
- `code-pattern`
- `dal-service-repository`
- `dependency-cruiser`
- `documentation`
- `internal-link`
- `mojibake`
- `package-surface`
- `rebuild-preflight`
- `repository-hygiene`
- `schema`
- `singleton-deps`
- `tsconfig`
- `workspace-manifest`

Configurable guard policy:

- `any`: source directories and additional exclusion regexes for AST-based TypeScript `any` keyword detection. Comments, strings, property names, and words merely containing `any` are not violations.
- `internalLink`: source directories and additional exclusion regexes.
- `schema`: central schema directory, scanned directories, configured Zod builders, and additional exclusions. Builder calls are recognized through direct and fluent chains.
- `rebuildPreflight`: named targets with warning text, Turbo filters, and relevant build packages.
- `repositoryHygiene`: forbidden and explicitly allowed regexes matched against normalized Git-tracked paths.
- `packageSurface`: post-build package directories and regexes forbidden in the npm dry-run inventory.
- `tsconfig`: package scope, config files, required includes, compiler options, public aliases, and literal forbidden text. Compiler options and aliases are checked after resolving `extends`.
- `workspaceManifest`: workspace package roots, internal workspace protocol policy, valid dependency ranges, exclusive runtime dependency sections, unique package names, and explicit provider/consumer peer requirements.
- `dalServiceRepository`: source root, tsconfig, layer classification, and forbidden layer dependencies.
- `codePattern`: tsconfig, model directory, and enabled rule scopes/allowlists.
- These guards fail clearly when their corresponding `guards` block is absent. There are no project-specific builtin profiles.
- Configured exclusions extend the safe CLI base. They do not replace dependency/build exclusions or common test patterns.
- Defining `guards.<name>` configures policy but does not execute the guard. Add the builtin to `repoCheck`, call `webtoolkit guard <name>` directly, or place build-dependent checks in `releaseGate`.
- Run `webtoolkit config --json guards` for the complete nested schema, including required fields and accepted value types.

Safe scan defaults:

- Source extensions: `.cjs`, `.cts`, `.js`, `.jsx`, `.mjs`, `.mts`, `.ts`, and `.tsx`.
- Artifact directories: `node_modules`, `dist`, `build`, and `coverage`.
- Source-policy exclusions: `*.test.*`, `*.test-*`, their `spec` equivalents, `test/`, `tests/`, `__tests__/`, and `*.stories.*`.

Complete guard wiring example:

```json
{
  "guards": {
    "any": {
      "includePaths": ["apps", "packages"]
    },
    "internalLink": {
      "includePaths": ["apps/web/src"]
    },
    "repositoryHygiene": {
      "forbiddenPathPatterns": ["(^|/)\\.env($|\\.)", "\\.(pem|key|p12)$"],
      "allowedPathPatterns": ["(^|/)\\.env\\.example$"]
    },
    "packageSurface": {
      "packageDirectories": ["packages/library"],
      "forbiddenPublishedPatterns": ["(^|/)__tests__/", "\\.(test|spec)\\."]
    },
    "schema": {
      "centralDirectory": "packages/contracts/src/schemas",
      "includePaths": ["apps/api/src", "apps/web/src"],
      "builders": ["object", "enum", "array", "nativeEnum"]
    },
    "tsconfig": {
      "packageScope": "@acme",
      "configs": [
        {
          "path": "tsconfig.json",
          "compilerOptions": {
            "strict": true
          },
          "publicAliases": ["@acme/library"]
        }
      ]
    },
    "workspaceManifest": {
      "packageRoots": ["apps", "packages"],
      "requireWorkspaceProtocol": true,
      "peerRequirements": [
        {
          "dependency": "example-runtime",
          "providers": ["packages/shared-ui"],
          "consumers": ["apps/web"]
        }
      ]
    }
  },
  "repoCheck": {
    "title": "Repository checks",
    "failFast": false,
    "steps": [
      {
        "label": "Repository hygiene",
        "builtinGuard": "repository-hygiene"
      },
      {
        "label": "TypeScript any",
        "builtinGuard": "any"
      },
      {
        "label": "Schema ownership",
        "builtinGuard": "schema"
      },
      {
        "label": "TSConfig policy",
        "builtinGuard": "tsconfig"
      },
      {
        "label": "Workspace manifests",
        "builtinGuard": "workspace-manifest"
      }
    ]
  },
  "releaseGate": {
    "stages": [
      {
        "name": "package-surface",
        "command": "webtoolkit",
        "args": ["guard", "package-surface"]
      }
    ]
  }
}
```

`workspaceManifest.packageRoots` are container directories. Their direct
children containing `package.json` are treated as workspace packages.
`peerDependencies` plus `devDependencies` is allowed for provider development;
providers must not keep the configured peer in runtime dependencies, consumers
must declare it in a runtime dependency section, and runtime dependency
sections remain mutually exclusive.

`repository-hygiene` reads only `git ls-files`; it does not inspect file
contents or consider ignored local files. Explicit `allowedPathPatterns` take
precedence over forbidden patterns. Use a dedicated consumer-owned secret
scanner when content scanning is required. Run it inside a Git worktree with
at least one tracked file.

`package-surface` validates `main`, `module`, `types`, `typings`, string/object
`bin`, and every file target under `exports`. It verifies both the built file
and its presence in the JSON inventory from
`npm pack --dry-run --json --ignore-scripts`, then rejects published paths that
match `forbiddenPublishedPatterns`. It does not build or publish. Build every
configured package first and keep this guard outside `repoCheck`. Wildcard or
unsupported export targets fail with their exact manifest field; `null` export
targets are intentionally ignored:

```bash
webtoolkit check
pnpm run build
webtoolkit release-gate package-surface
```

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

- `layout.rows`: ordered terminal rows from top to bottom.
- each row requires `panes`, ordered from left to right. Panes in the same row receive equal widths, and rows receive equal heights.
- each pane requires `title` and `command`, and can optionally define:
  - `silentCommand`: command used by `webtoolkit dev-grid --silent`.
  - `fontSize`: positive integer font size applied through a temporary Windows Terminal fragment profile.
- `fallbackScript` and `silentFallbackScript`: package scripts used when Windows Terminal is unavailable.
- `preflightCommand`: optional task step run before opening the grid.
- `layout.rows` is mandatory. The former flat `panes`, `maxPanels`, and per-pane `fullWidth` fields are not accepted.

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
    "failFast": false,
    "steps": [
      {
        "label": "TypeScript Guard",
        "builtinGuard": "tsconfig"
      },
      {
        "label": "Architecture Lint",
        "builtinGuard": "dependency-cruiser",
        "args": ["src", "--config", ".dependency-cruiser.cjs"]
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
    "rawWarningBytes": 1000000,
    "budgets": [
      {
        "appDir": "apps/frontend",
        "label": "main bundle",
        "pattern": "^index-.*\\.js$",
        "maxRawBytes": 500000,
        "required": true
      }
    ]
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
    "layout": {
      "rows": [
        {
          "panes": [
            {
              "title": "FRONTEND USER",
              "command": "pnpm run dev:frontend-user",
              "silentCommand": "pnpm run dev:frontend-user:silent",
              "fontSize": 15
            }
          ]
        },
        {
          "panes": [
            {
              "title": "BACKEND",
              "command": "pnpm run dev:backend"
            }
          ]
        }
      ]
    }
  },
  "environment": {
    "requiredNodeMajor": 26,
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
