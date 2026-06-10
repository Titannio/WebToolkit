import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'

export type CommandResult = {
  code: number
  output: string
}

export type CommandSpec = {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

export function resolveCwd(rootDir: string, cwd?: string): string {
  if (!cwd) return rootDir
  return path.isAbsolute(cwd) ? cwd : path.join(rootDir, cwd)
}

export function formatCommand(command: string, args: string[] = []): string {
  return [command, ...args].map((arg) => (/[\s"]/u.test(arg) ? JSON.stringify(arg) : arg)).join(' ')
}

export function buildPackageManagerCommand(packageManager: string, args: string[]): CommandSpec {
  const npmExecPath = process.env.npm_execpath

  if (npmExecPath && packageManager === 'pnpm') {
    return { command: process.execPath, args: [npmExecPath, ...args] }
  }

  return {
    command: process.platform === 'win32' && packageManager === 'pnpm' ? 'pnpm.cmd' : packageManager,
    args,
  }
}

const WINDOWS_CMD_WRAPPED_COMMANDS = new Set([
  'npm',
  'npm.cmd',
  'pnpm',
  'pnpm.cmd',
  'webtoolkit',
  'webtoolkit.cmd',
  'yarn',
  'yarn.cmd',
])

export function resolveSpawnSpec(command: string, args: string[] = []): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command, args }

  if (!WINDOWS_CMD_WRAPPED_COMMANDS.has(command)) return { command, args }

  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', command.replace(/\.cmd$/iu, ''), ...args],
  }
}

export function runCommandBuffered(spec: CommandSpec, rootDir: string): Promise<CommandResult> {
  const resolved = resolveSpawnSpec(spec.command, spec.args ?? [])
  const child = spawn(resolved.command, resolved.args, {
    cwd: resolveCwd(rootDir, spec.cwd),
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      ...(spec.env ?? {}),
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })

  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

export function runCommandInherited(spec: CommandSpec, rootDir: string): number {
  const resolved = resolveSpawnSpec(spec.command, spec.args ?? [])
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: resolveCwd(rootDir, spec.cwd),
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      ...(spec.env ?? {}),
    },
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  return result.status ?? 1
}
