# Repo-Check Audit Playbook

Use this playbook to repeat the `repo-check` audit from the current checkout.
Do not reuse old conclusions without verifying them against the live CLI source
and at least one real consumer.

## Goal

Produce an evidence-backed assessment of:

1. Important repository-health checks that are missing.
2. Whether existing checks remain deterministic, read-only, tested, portable,
   and correctly enforced.
3. Consumer-local practices that should become generic checks.
4. Improvements that can ship together without changing healthy behavior.

Keep `repo-check` separate from `validate`, tests, coverage, build, and
`release-gate` unless consolidation is explicitly requested.

## Safety

- Start read-only.
- Inspect consumer arguments before running `webtoolkit check`; a configured
  guard may receive mutating arguments such as `--fix`.
- Do not install dependencies, access secrets, publish packages, or change a
  consumer while auditing.
- Prefer focused tests. Do not run full consumer workspace suites unless
  explicitly requested.
- Treat a configured scan that examines zero files as suspicious, not as proof
  of compliance.

## Primary Surfaces

Inspect these CLI files first:

- `packages/cli/src/repo-check.ts`
- `packages/cli/src/config.ts`
- `packages/cli/src/config-reference.ts`
- `packages/cli/src/guard-runner.ts`
- `packages/cli/src/guards/`
- `packages/cli/src/repo-check.test.ts`
- `packages/cli/src/guard-runner.test.ts`
- `packages/cli/vitest.config.ts`
- `packages/cli/README.md`

For a selected consumer, inspect:

- `.webtoolkit-cli/config.json`
- `.webtoolkit-cli/dependency-cruiser.cjs`, when present
- `package.json`
- CI workflow files
- architecture and integrity tests

State which checkout was selected without encoding its identity into this
playbook.

## Audit Procedure

### 1. Establish the current state

From the repository root:

```powershell
git status --short
rg -n "builtinGuards|repoCheck|builtinGuard" packages/cli/src packages/cli/README.md
Get-ChildItem packages/cli/src/guards -File | Sort-Object Name
```

Record the CLI version, builtin guard names, configured step schema, and test
coverage policy.

### 2. Map the real consumer pipeline

```powershell
$consumerRepo = 'C:\path\to\consumer'
rg -n '"repoCheck"|"builtinGuard"|"--fix"' "$consumerRepo\.webtoolkit-cli\config.json"
rg -n "maintenance:check|webtoolkit check" "$consumerRepo\package.json" "$consumerRepo\.github"
```

Confirm:

- which builtins are actually used;
- whether any step mutates files;
- whether the complete `repo-check` runs in CI;
- whether lint/type-check/build names are being mistaken for repo-check
  enforcement.

### 3. Review every configured check

For each check, answer:

- Is the check read-only by default?
- Is it deterministic and offline?
- Is policy supplied by the consumer or hardcoded for one repository?
- Does it fail clearly when its configured scope is missing or empty?
- Does it use TypeScript/ESLint/dependency-cruiser/Node before custom parsing?
- Are positive, negative, allowlist, zero-match, and malformed-input cases
  tested?
- Can it silently miss common syntax variants?
- Does its output identify the correct rule and file?
- Is the same invariant already enforced elsewhere?

Useful regression probes:

```powershell
rg -n "@ts-nocheck|includeDirs|WATCH_PATHS|INCLUDE_PATHS|ALLOW_.*PATHS" packages/cli/src/guards
rg -n "RULES\[[0-9]+\]|process\.exit|writeFile|rmSync|unlinkSync" packages/cli/src/guards
rg -n "src/guards/\*\*|coverage|thresholds" packages/cli/vitest.config.ts
rg -n "describe\(|it\(" packages/cli/src/guards -g "*.test.ts"
```

Review custom regex or AST checks with concrete examples that should pass and
fail. Do not infer completeness from a green run on one consumer.

### 4. Compare consumer-local practices

Search the consumer for architecture and integrity tests:

```powershell
$consumerRepo = 'C:\path\to\consumer'
rg --files "$consumerRepo" |
  rg "architecture|integrity|audit|build-integrity|dependency-integrity|schema-indexes"
```

Promote a practice to the shared CLI only when its invariant is reusable without
naming a product, framework topology, domain model, or deployment provider.

Good generic candidates usually concern:

- configuration validity;
- workspace manifests and internal dependency declarations;
- published package surfaces;
- tracked repository artifacts;
- documentation links and inventories;
- explicitly configured singleton/peer dependency policy.

Keep domain models, protocol conventions, UI component policy, styling order,
framework-specific boundaries, and provider-specific deployment rules in
consumer-owned tests or dependency-cruiser configuration.

### 5. Run only focused, non-mutating verification

From `packages/cli`:

```powershell
npm test -- src/repo-check.test.ts src/guard-runner.test.ts src/config.test.ts src/guards/documentation-guard.test.ts src/guards/dependency-cruiser-guard.test.ts
```

From a consumer, individual read-only guards may be run after inspecting their
arguments. For example:

```powershell
pnpm exec webtoolkit guard mojibake
pnpm exec webtoolkit guard documentation
```

Do not run a configured aggregate until every step is known to be read-only.

### 6. Score findings

Use 0-10 scores:

- **Priority:** how soon the item should be handled.
- **Benefit:** expected quality, safety, or maintenance gain.
- **Importance:** severity of the failure prevented.

Report four groups:

1. Existing checks and orchestration problems.
2. New generic check candidates.
3. Consumer-local practices that should stay local.
4. Recommended implementation order.

Every material claim should cite a current file and line.

## Win-Win Batch Filter

An item belongs in one low-risk batch only when all are true:

- it fixes objectively wrong behavior or missing verification;
- healthy repositories keep the same accepted behavior;
- it does not add a dependency, network call, or new product policy;
- it remains read-only and deterministic;
- it has one focused regression test;
- the current consumer can validate it without migration or compatibility code.

Typical win-win items:

- correct a guard that reports the wrong rule;
- replace a mutating aggregate-check argument with read-only scanning while
  preserving an explicit standalone fix command;
- reject internally contradictory `repoCheck` steps;
- test existing guard behavior that is already intended;
- improve failure summaries without changing pass/fail policy.

Keep these out of that batch:

- new guards that may expose existing debt;
- wider scan scopes or stricter policy;
- replacing a custom guard with ESLint or dependency-cruiser;
- converting repository-specific guards to consumer configuration;
- CI enforcement before the aggregate is confirmed read-only and green;
- dependency, security, license, build, or release policy changes.

After implementation, rerun focused CLI tests, the affected read-only consumer
guards, and `git diff --check`. Report broader validation separately rather
than silently expanding the batch.
