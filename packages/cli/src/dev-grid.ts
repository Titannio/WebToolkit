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

function createPaneArgs(repoRoot: string, subcommand: string, orientation: string | null, pane: DevGridPaneConfig, silent: boolean): string[] {
  const args = [subcommand]
  if (orientation) args.push(orientation)
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

function createWindowsTerminalCommands(repoRoot: string, panes: DevGridPaneConfig[], silent: boolean, windowName: string): string[][] {
  const [firstPane, secondPane, thirdPane, fourthPane] = panes
  const commands: string[][] = [
    ['--window', windowName, '--maximized', ...createPaneArgs(repoRoot, 'new-tab', null, firstPane, silent)],
  ]

  if (secondPane) commands.push(['--window', windowName, ...createPaneArgs(repoRoot, 'split-pane', '--vertical', secondPane, silent)])
  if (thirdPane) commands.push(['--window', windowName, 'move-focus', 'left'], ['--window', windowName, ...createPaneArgs(repoRoot, 'split-pane', '--horizontal', thirdPane, silent)])
  if (fourthPane) commands.push(['--window', windowName, 'move-focus', 'up'], ['--window', windowName, 'move-focus', 'right'], ['--window', windowName, ...createPaneArgs(repoRoot, 'split-pane', '--horizontal', fourthPane, silent)])

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
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ executable: runtime.config.packageManager, args: ['run', script], reason }, null, 2)}\n`)
    process.exit(0)
  }

  process.stderr.write(`${reason} Falling back to \`${runtime.config.packageManager} run ${script}\`.\n`)
  const executable = process.platform === 'win32' ? `${runtime.config.packageManager}.cmd` : runtime.config.packageManager
  const result = spawnSync(executable, ['run', script], { cwd: runtime.cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

export function runDevGrid(runtime: Runtime, rawArgs: string[]): void {
  const config = runtime.config.devGrid
  if (!config?.panes?.length) throw new Error('devGrid.panes is not configured.')

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
  const commands = createWindowsTerminalCommands(runtime.cwd, config.panes, silent, windowName)

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
