import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { DevGridPaneConfig, DevGridRowConfig, TaskStepConfig, WebToolkitCliConfig } from './config.js'
import { runCommandInherited } from './process.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

const WINDOWS_TERMINAL_FRAGMENT_APP_NAME = 'WebToolkit.Cli'
const WINDOWS_TERMINAL_FRAGMENT_FILE_NAME = 'dev-grid.json'

function getPowerShellExecutable(): string {
  const pwshResult = spawnSync('where.exe', ['pwsh'], { stdio: 'ignore', windowsHide: true })
  return pwshResult.status === 0 ? 'pwsh' : 'powershell.exe'
}

function hasWindowsTerminal(): boolean {
  const result = spawnSync('where.exe', ['wt.exe'], { stdio: 'ignore', windowsHide: true })
  return result.status === 0
}

function createPaneCommand(command: string): string[] {
  return [getPowerShellExecutable(), '-NoLogo', '-NoExit', '-Command', `$env:FORCE_COLOR = '1'\n${command}`]
}

function createPaneArgs(
  repoRoot: string,
  subcommand: string,
  orientation: string | null,
  pane: DevGridPaneConfig,
  silent: boolean,
  profileName?: string,
  size?: number,
): string[] {
  const args = [subcommand]
  if (orientation) args.push(orientation)
  if (size !== undefined) args.push('--size', String(Number(size.toFixed(6))))
  if (profileName) args.push('--profile', profileName)
  args.push(
    '--startingDirectory',
    repoRoot,
    '--title',
    pane.title,
    '--suppressApplicationTitle',
    ...createPaneCommand(silent ? pane.silentCommand ?? pane.command : pane.command),
  )
  return args
}

function getValidatedDevGridRows(rows: DevGridRowConfig[]): DevGridRowConfig[] {
  for (const [rowIndex, row] of rows.entries()) {
    if (!row.panes.length) throw new Error(`devGrid.layout.rows[${rowIndex}].panes is not configured.`)
    for (const pane of row.panes) {
      if (pane.fontSize === undefined) continue
      if (!Number.isInteger(pane.fontSize) || pane.fontSize <= 0) {
        throw new Error(`devGrid pane "${pane.title}" has invalid fontSize ${String(pane.fontSize)}. Use a positive integer.`)
      }
    }
  }

  return rows
}

function getWindowsTerminalFragmentFilePath(): string {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) {
    throw new Error('LOCALAPPDATA is not defined. Cannot configure Windows Terminal fragment profiles for devGrid.')
  }

  return join(
    localAppData,
    'Microsoft',
    'Windows Terminal',
    'Fragments',
    WINDOWS_TERMINAL_FRAGMENT_APP_NAME,
    WINDOWS_TERMINAL_FRAGMENT_FILE_NAME,
  )
}

function buildPaneProfileName(repoRoot: string, pane: DevGridPaneConfig): string {
  const hash = createHash('sha1')
    .update(`${repoRoot}\n${pane.title}\n${String(pane.fontSize)}`)
    .digest('hex')
    .slice(0, 12)

  return `WebToolkit Dev Grid ${hash}`
}

function preparePaneProfiles(repoRoot: string, panes: DevGridPaneConfig[], persist: boolean): Map<DevGridPaneConfig, string> {
  const panesWithFontSize = panes.filter((pane) => pane.fontSize !== undefined)
  if (!panesWithFontSize.length) return new Map()

  const profiles = panesWithFontSize.map((pane) => ({
    name: buildPaneProfileName(repoRoot, pane),
    hidden: true,
    commandline: getPowerShellExecutable(),
    fontSize: pane.fontSize,
  }))

  if (persist) {
    const fragmentFilePath = getWindowsTerminalFragmentFilePath()
    mkdirSync(dirname(fragmentFilePath), { recursive: true })
    writeFileSync(fragmentFilePath, `${JSON.stringify({ profiles }, null, 2)}\n`, 'utf8')
  }

  return new Map(profiles.map((profile, index) => [panesWithFontSize[index], profile.name]))
}

function createWindowsTerminalCommands(
  repoRoot: string,
  rows: DevGridRowConfig[],
  silent: boolean,
  windowName: string,
  paneProfiles: Map<DevGridPaneConfig, string>,
): string[][] {
  const firstPane = rows[0].panes[0]
  const commands: string[][] = [
    ['--window', windowName, '--maximized', ...createPaneArgs(repoRoot, 'new-tab', null, firstPane, silent, paneProfiles.get(firstPane))],
  ]

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const pane = rows[rowIndex].panes[0]
    const remainingRows = rows.length - rowIndex
    commands.push([
      '--window',
      windowName,
      ...createPaneArgs(repoRoot, 'split-pane', '--horizontal', pane, silent, paneProfiles.get(pane), remainingRows / (remainingRows + 1)),
    ])
  }

  if (rows.length > 1) commands.push(['--window', windowName, 'move-focus', 'first'])

  for (const [rowIndex, row] of rows.entries()) {
    for (let paneIndex = 1; paneIndex < row.panes.length; paneIndex += 1) {
      const pane = row.panes[paneIndex]
      const remainingPanes = row.panes.length - paneIndex
      commands.push([
        '--window',
        windowName,
        ...createPaneArgs(repoRoot, 'split-pane', '--vertical', pane, silent, paneProfiles.get(pane), remainingPanes / (remainingPanes + 1)),
      ])
    }
    if (rowIndex < rows.length - 1) commands.push(['--window', windowName, 'move-focus', 'down'])
  }

  return commands
}

function runStep(runtime: Runtime, step: TaskStepConfig): void {
  if (!step.command) {
    throw new Error(`Dev grid step "${step.label}" must define command.`)
  }

  const code = runCommandInherited({
    command: step.command,
    args: step.args ?? [],
    cwd: step.cwd,
    env: step.env,
  }, runtime.cwd)
  if (code !== 0) process.exit(code)
}

function runFallback(runtime: Runtime, script: string, reason: string, dryRun: boolean): void {
  const normalizedScript = normalizeFallbackScript(script)
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ executable: runtime.config.packageManager, args: ['run', normalizedScript], reason }, null, 2)}\n`)
    process.exit(0)
  }

  process.stderr.write(`${reason} Falling back to \`${runtime.config.packageManager} run ${normalizedScript}\`.\n`)
  const executable = process.platform === 'win32' ? `${runtime.config.packageManager}.cmd` : runtime.config.packageManager
  const result = spawnSync(executable, ['run', normalizedScript], {
    cwd: runtime.cwd,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

function normalizeFallbackScript(script: string): string {
  const normalized = script.trim().replace(/\s+/gu, ' ')
  const match = normalized.match(/^(?:npm|pnpm|yarn) run (.+)$/u)
  return match ? match[1] : normalized
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

export function runDevGrid(runtime: Runtime, rawArgs: string[]): void {
  const config = runtime.config.devGrid
  if (!config?.layout?.rows?.length) throw new Error('devGrid.layout.rows is not configured.')

  const rows = getValidatedDevGridRows(config.layout.rows)
  const panes = rows.flatMap((row) => row.panes)
  const silent = rawArgs.includes('--silent')
  const dryRun = rawArgs.includes('--dry-run')
  const fallbackScript = silent ? config.silentFallbackScript ?? config.fallbackScript : config.fallbackScript

  if (process.platform !== 'win32') {
    if (!fallbackScript) throw new Error('Windows Terminal grid is unavailable and no devGrid.fallbackScript is configured.')
    runFallback(runtime, fallbackScript, 'Windows Terminal grid is unavailable on this platform.', dryRun)
    return
  }

  if (!dryRun && config.preflightCommand) runStep(runtime, config.preflightCommand)

  if (!hasWindowsTerminal()) {
    if (!fallbackScript) throw new Error('Windows Terminal (`wt.exe`) is unavailable and no devGrid.fallbackScript is configured.')
    runFallback(runtime, fallbackScript, 'Windows Terminal (`wt.exe`) is not available.', dryRun)
    return
  }

  const windowName = `webtoolkit-dev-grid-${Date.now()}-${process.pid}`
  const paneProfiles = preparePaneProfiles(runtime.cwd, panes, !dryRun)
  const commands = createWindowsTerminalCommands(runtime.cwd, rows, silent, windowName, paneProfiles)

  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ executable: 'wt.exe', commands }, null, 2)}\n`)
    return
  }

  for (const [index, commandArgs] of commands.entries()) {
    const result = spawnSync('wt.exe', commandArgs, { cwd: runtime.cwd, windowsHide: true, stdio: 'pipe', encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status !== 0) {
      const details = result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status}`
      throw new Error(`Windows Terminal command failed: ${details}`)
    }
    if (index < commands.length - 1) sleep(250)
  }
}
