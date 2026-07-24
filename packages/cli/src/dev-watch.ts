import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

import type { DevAppConfig, WebToolkitCliConfig } from './config.js'
import { buildPackageManagerCommand, resolveSpawnSpec } from './process.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

const isWindows = process.platform === 'win32'

export function resolveDevWatchSpawnSpec(command: string, commandArgs: string[]): { command: string; args: string[]; detached: boolean } {
  const resolved = resolveSpawnSpec(command, commandArgs)
  return { ...resolved, detached: !isWindows }
}

function spawnCommand(command: string, commandArgs: string[], options = {}) {
  const resolved = resolveDevWatchSpawnSpec(command, commandArgs)
  return spawn(resolved.command, resolved.args, { ...options, detached: resolved.detached })
}

function getArgValue(args: string[], name: string): string | null {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

function getSelectedApps(runtime: Runtime, args: string[]): string[] {
  const appsArg = getArgValue(args, 'apps')
  if (!appsArg) return [...(runtime.config.devWatch?.defaultApps ?? [])]
  return appsArg.split(',').map((app) => app.trim()).filter(Boolean)
}

function checkPortAvailability(port: number, host: string): Promise<{ available: boolean; error?: NodeJS.ErrnoException; host: string; port: number }> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', (error: NodeJS.ErrnoException) => resolve({ available: false, error, host, port }))
    server.listen({ host, port }, () => {
      server.close((error) => resolve({ available: !error, error: error ?? undefined, host, port }))
    })
  })
}

function getPortFromEndpoint(endpoint: string): number | null {
  const bracketedIpv6Match = endpoint.match(/\]:(\d+)$/u)
  if (bracketedIpv6Match) return Number(bracketedIpv6Match[1])
  const separatorIndex = endpoint.lastIndexOf(':')
  if (separatorIndex === -1) return null
  const port = Number(endpoint.slice(separatorIndex + 1))
  return Number.isInteger(port) ? port : null
}

export function parseWindowsNetstatListeningPids(output: string, port: number): number[] {
  const pids = new Set<number>()

  for (const line of String(output ?? '').split(/\r?\n/u)) {
    const parts = line.trim().split(/\s+/u)
    if (parts.length < 4 || parts[0] !== 'TCP') continue
    const state = parts[parts.length - 2]
    const pid = Number(parts[parts.length - 1])
    if (state === 'LISTENING' && Number.isInteger(pid) && getPortFromEndpoint(parts[1]) === port) {
      pids.add(pid)
    }
  }

  return [...pids].sort((left, right) => left - right)
}

function listListeningPidsByPort(port: number): number[] {
  if (isWindows) {
    for (const command of ['netstat.exe', 'netstat']) {
      const result = spawnSync(command, ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
      if (!result.error && result.status === 0) return parseWindowsNetstatListeningPids(result.stdout, port)
    }
    return []
  }

  const result = spawnSync('lsof', ['-ti', `TCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) return []
  return result.stdout.split(/\r?\n/u).map((value) => Number(value.trim())).filter((pid) => Number.isInteger(pid))
}

function stopProcessTree(pid: number): boolean {
  if (isWindows) {
    const result = spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { stdio: 'pipe', windowsHide: true })
    return !result.error && result.status === 0
  }

  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

async function stopExistingListenersOnPort(port: number, displayName: string, graceMs: number) {
  const pids = listListeningPidsByPort(port)
  if (pids.length === 0) return []

  console.warn(`Stopping existing ${displayName} listener(s) on port ${port}: PID ${pids.join(', ')}`)
  for (const pid of pids) stopProcessTree(pid)
  await new Promise((resolve) => setTimeout(resolve, graceMs))
  return listListeningPidsByPort(port)
}

async function ensurePortsAvailable(apps: Array<{ key: string; definition: DevAppConfig }>, host: string): Promise<boolean> {
  const results = await Promise.all(apps.map(async ({ key, definition }) => ({
    key,
    definition,
    probe: await checkPortAvailability(definition.port, host),
  })))
  const blockedApps = results.filter(({ probe }) => !probe.available)
  if (blockedApps.length === 0) return true

  console.error('DEV port preflight failed.\n')
  for (const { definition, probe } of blockedApps) {
    const reason = probe.error?.code ?? probe.error?.message ?? 'unknown error'
    console.error(`- ${definition.displayName}: ${probe.host}:${probe.port} (${reason})`)
  }
  return false
}

function stopChildTree(child: ReturnType<typeof spawn>): void {
  if (child.exitCode !== null || child.signalCode !== null || typeof child.pid !== 'number') return
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
    return
  }

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

function runWatch(runtime: Runtime, selectedApps: Array<{ key: string; definition: DevAppConfig }>, silent: boolean): void {
  const children: ReturnType<typeof spawn>[] = []
  let shuttingDown = false

  function shutdown(exitCode: number): void {
    if (shuttingDown) return
    shuttingDown = true
    for (const child of children) stopChildTree(child)
    process.exitCode = exitCode
  }

  for (const { key, definition } of selectedApps) {
    if (!definition.filter) throw new Error(`devWatch app "${key}" must define filter to run watch mode.`)
    const extraArgs = silent ? ['--', '--logLevel', 'warn'] : []
    const commandSpec = buildPackageManagerCommand(runtime.config.packageManager, ['--filter', definition.filter, 'run', 'dev:skip-check', ...extraArgs])
    const child = spawnCommand(commandSpec.command, commandSpec.args ?? [], { stdio: 'inherit', cwd: runtime.cwd })
    children.push(child)
    child.on('error', (error) => {
      console.error(`[${key.toUpperCase()}] ${error.message}`)
      shutdown(1)
    })
    child.on('exit', (code, signal) => {
      if (shuttingDown) return
      const exitCode = code ?? (signal ? 1 : 0)
      if (exitCode !== 0) console.error(`[${key.toUpperCase()}] exited with ${signal ?? code}`)
      shutdown(exitCode)
    })
  }

  process.on('SIGINT', () => shutdown(130))
  process.on('SIGTERM', () => shutdown(143))
}

export async function runDevWatch(runtime: Runtime, rawArgs: string[]): Promise<void> {
  const config = runtime.config.devWatch
  if (!config?.apps || !config.defaultApps?.length) throw new Error('devWatch.apps and devWatch.defaultApps are not configured.')

  const silent = rawArgs.includes('--silent')
  const checkOnly = rawArgs.includes('--check-only')
  const includeBackend = rawArgs.includes('--include-backend')
  const backendApp = config.backendApp ?? 'backend'
  const selectedKeys = [...(includeBackend && checkOnly ? [backendApp] : []), ...getSelectedApps(runtime, rawArgs)]
  const unknownApps = selectedKeys.filter((app) => !config.apps[app])
  if (unknownApps.length > 0) throw new Error(`Unknown dev app(s): ${unknownApps.join(', ')}`)

  const selectedApps = selectedKeys.map((key) => ({ key, definition: config.apps[key] }))
  if (checkOnly && selectedKeys.includes(backendApp)) {
    const backend = config.apps[backendApp]
    const remainingPids = await stopExistingListenersOnPort(backend.port, backend.displayName, config.backendPortCleanupGraceMs ?? 1500)
    if (remainingPids.length > 0) {
      throw new Error(`Could not stop existing ${backend.displayName} listener(s) on port ${backend.port}: PID ${remainingPids.join(', ')}`)
    }
  }

  const portsAvailable = await ensurePortsAvailable(selectedApps, config.host ?? '127.0.0.1')
  if (!portsAvailable) process.exit(1)
  if (checkOnly) return

  runWatch(runtime, selectedApps.filter(({ key }) => key !== backendApp), silent)
}
