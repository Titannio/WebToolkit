import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const builtinGuards: Record<string, string> = {
  any: 'any-guard.js',
  'assert-no-tests-in-dist': 'assert-no-tests-in-dist.js',
  'code-pattern': 'code-pattern-guard.js',
  'dal-service-repository': 'dal-service-repository-check.js',
  'dependency-cruiser': 'dependency-cruiser-guard.js',
  'docs-inventory': 'docs-inventory-guard.js',
  'internal-link': 'internal-link-guard.js',
  mojibake: 'check-mojibake.js',
  'rebuild-preflight': 'rebuild-preflight.js',
  schema: 'schema-guard.js',
  'singleton-deps': 'singleton-deps-guard.js',
  tsconfig: 'tsconfig-guard.js',
}

function getGuardsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'guards')
}

export function printGuardHelp(): void {
  console.info('Usage: webtoolkit guard <name> [args]')
  console.info('')
  console.info('Builtin guards:')
  for (const name of Object.keys(builtinGuards).sort()) {
    console.info(`  ${name}`)
  }
}

export function executeBuiltinGuard(name: string, args: string[], cwd: string): number {
  const guardFile = builtinGuards[name]
  if (!guardFile) {
    throw new Error(`Unknown builtin guard "${name}". Available guards: ${Object.keys(builtinGuards).sort().join(', ')}.`)
  }

  const result = spawnSync(process.execPath, [path.join(getGuardsDir(), guardFile), ...args], {
    cwd,
    env: {
      ...process.env,
      FORCE_COLOR: '1',
    },
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  return result.status ?? 1
}

export function runBuiltinGuard(name: string, args: string[], cwd: string): void {
  process.exit(executeBuiltinGuard(name, args, cwd))
}
