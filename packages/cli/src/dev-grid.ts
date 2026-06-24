import { spawnSync } from 'node:child_process'

import type { DevGridPaneConfig, TaskStepConfig, WebToolkitCliConfig } from './config.js'
import { runCommandInherited } from './process.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

function getPowerShellExecutable(): string {
  const pwshResult = spawnSync('where.exe', ['pwsh'], { stdio: 'ignore', windowsHide: true })
  return pwshResult.status === 0 ? 'pwsh' : 'powershell.exe'
}

function hasWindowsTerminal(): boolean {
  const result = spawnSync('where.exe', ['wt.exe'], { stdio: 'ignore', windowsHide: true })
  return result.status === 0
}

function createPaneCommand(command: string): string[] {
  return [getPowerShellExecutable(), '-NoLogo', '-NoExit', '-Command', command]
}

function createPaneArgs(
  repoRoot: string,
  subcommand: string,
  orientation: string | null,
  pane: DevGridPaneConfig,
  silent: boolean,
): string[] {
  const args = [subcommand]
  if (orientation) args.push(orientation)
  if (pane.fontSize !== undefined) args.push('--fontSize', String(pane.fontSize))
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

function getValidatedDevGridPanes(panes: DevGridPaneConfig[], maxPanels: number | undefined): DevGridPaneConfig[] {
  if (maxPanels !== undefined && (!Number.isInteger(maxPanels) || maxPanels <= 0)) {
    throw new Error('devGrid.maxPanels must be a positive integer.')
  }

  const validatedPanes = maxPanels === undefined ? panes : panes.slice(0, maxPanels)
  if (!validatedPanes.length) {
    throw new Error('devGrid.panes is not configured.')
  }

  const fullWidthIndexes = validatedPanes.flatMap((pane, index) => (pane.fullWidth ? [index] : []))
  if (fullWidthIndexes.length > 1) {
    throw new Error('devGrid supports at most one pane with fullWidth: true.')
  }

  for (const pane of validatedPanes) {
    if (pane.fontSize === undefined) continue
    if (!Number.isInteger(pane.fontSize) || pane.fontSize <= 0) {
      throw new Error(`devGrid pane "${pane.title}" has invalid fontSize ${String(pane.fontSize)}. Use a positive integer.`)
    }
  }

  return validatedPanes
}

function createWindowsTerminalCommands(repoRoot: string, panes: DevGridPaneConfig[], silent: boolean, windowName: string): string[][] {
  const fullWidthIndex = panes.findIndex((pane) => pane.fullWidth)
  const rows: DevGridPaneConfig[][] = []

  if (fullWidthIndex === -1) {
    for (let i = 0; i < panes.length; i += 2) {
      rows.push(panes.slice(i, i + 2))
    }
  } else {
    const beforeFullWidth = panes.slice(0, fullWidthIndex)
    const fullWidthPane = panes[fullWidthIndex]
    const afterFullWidth = panes.slice(fullWidthIndex + 1)

    for (let i = 0; i < beforeFullWidth.length; i += 2) {
      rows.push(beforeFullWidth.slice(i, i + 2))
    }
    rows.push([fullWidthPane])
    for (let i = 0; i < afterFullWidth.length; i += 2) {
      rows.push(afterFullWidth.slice(i, i + 2))
    }
  }

  const [firstRow, ...remainingRows] = rows
  const firstPane = firstRow[0]
  const commands: string[][] = [
    ['--window', windowName, '--maximized', ...createPaneArgs(repoRoot, 'new-tab', null, firstPane, silent)],
  ]

  if (firstRow[1]) {
    commands.push(['--window', windowName, ...createPaneArgs(repoRoot, 'split-pane', '--vertical', firstRow[1], silent)])
  }

  let previousRow = firstRow
  for (const row of remainingRows) {
    if (previousRow.length === 2) {
      commands.push(['--window', windowName, 'move-focus', 'left'])
    }

    const [leftPane, rightPane] = row
    commands.push(['--window', windowName, ...createPaneArgs(repoRoot, 'split-pane', '--horizontal', leftPane, silent)])
    if (rightPane) {
      commands.push(['--window', windowName, ...createPaneArgs(repoRoot, 'split-pane', '--vertical', rightPane, silent)])
    }
    previousRow = row
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
  const result = spawnSync(executable, ['run', normalizedScript], { cwd: runtime.cwd, stdio: 'inherit' })
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
  if (!config?.panes?.length) throw new Error('devGrid.panes is not configured.')

  const validatedPanes = getValidatedDevGridPanes(config.panes, config.maxPanels)
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
  const commands = createWindowsTerminalCommands(runtime.cwd, validatedPanes, silent, windowName)

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
