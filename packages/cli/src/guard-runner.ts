import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinGuards } from './guard-registry.js'

export { builtinGuards } from './guard-registry.js'

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
  const guardFile = Object.hasOwn(builtinGuards, name) ? builtinGuards[name] : undefined
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
