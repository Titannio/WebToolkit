import { spawn } from 'node:child_process'
import path from 'node:path'

import type { TaskConfig, TaskOutputMode, TaskStepConfig, WebToolkitCliConfig } from './config.js'
import { executeBuiltinGuard } from './guard-runner.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

const taskAliases: Record<string, string> = {
  check: 'check',
  build: 'build',
  test: 'test',
  'test-coverage': 'testCoverage',
  'release-gate': 'releaseGate',
  validate: 'validate',
  'jsdoc-report': 'jsdocReport',
  upgrade: 'upgrade',
  performance: 'performanceBundleAudit',
  'performance-bundle-audit': 'performanceBundleAudit',
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(2)}s`
}

function resolveWorkingDirectory(runtime: Runtime, step: TaskStepConfig): string {
  if (!step.cwd) return runtime.cwd
  if (path.isAbsolute(step.cwd)) return step.cwd
  return path.join(runtime.cwd, step.cwd)
}

function resolveCommand(step: TaskStepConfig, args: string[]): { command: string; args: string[]; shell: boolean } {
  if (!step.command) {
    throw new Error(`Task step "${step.label}" must define command or builtinGuard.`)
  }

  if (process.platform !== 'win32') {
    return { command: step.command, args, shell: false }
  }

  if (step.command === 'node' || step.command === process.execPath) {
    return { command: step.command, args, shell: false }
  }

  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', step.command, ...args],
    shell: false,
  }
}

function colorizeResult(status: 'OK' | 'FALHA' | 'SKIP'): string {
  if (status === 'OK') return `\x1b[32m${status}\x1b[0m`
  if (status === 'FALHA') return `\x1b[31m${status}\x1b[0m`
  return `\x1b[90m${status}\x1b[0m`
}

export function formatTaskStatusLine(options: {
  action: string
  label: string
  status?: 'OK' | 'FALHA' | 'SKIP'
  durationMs?: number
}): string {
  const duration = options.durationMs === undefined ? '' : ` (${formatDuration(options.durationMs)})`
  const status = options.status === undefined ? '' : ` ${colorizeResult(options.status)}${duration}`

  return `- ${options.action} \x1b[1m${options.label.padEnd(16)}\x1b[0m...${status}`
}

function getStepAction(step: TaskStepConfig): string {
  return step.args?.includes('build') ? 'Building' : 'Running'
}

function runStep(step: TaskStepConfig, runtime: Runtime, passthroughArgs: string[], defaultOutputMode: TaskOutputMode): Promise<{ code: number; output: string }> {
  const args = [...(step.args ?? []), ...(step.appendArgs ? normalizePassthroughArgs(passthroughArgs) : [])]
  const outputMode = step.outputMode ?? defaultOutputMode

  if (step.builtinGuard) {
    return Promise.resolve({ code: executeBuiltinGuard(step.builtinGuard, args, runtime.cwd), output: '' })
  }

  const resolved = resolveCommand(step, args)
  const child = spawn(resolved.command, resolved.args, {
    cwd: resolveWorkingDirectory(runtime, step),
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      ...(step.env ?? {}),
    },
    shell: resolved.shell,
    stdio: outputMode === 'inherit' ? 'inherit' : ['inherit', 'pipe', 'pipe'],
  })

  let output = ''

  if (outputMode === 'buffered') {
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
  }

  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

export function resolveTaskName(command: string): string | null {
  if (command.startsWith('run:')) return command.slice('run:'.length)
  return taskAliases[command] ?? null
}

export function normalizePassthroughArgs(args: string[]): string[] {
  if (args[0] === '--') return args.slice(1)
  return args
}

export function listTaskCommands(config: WebToolkitCliConfig): string[] {
  return Object.keys(config.tasks).sort()
}

export function printTaskHelp(taskName: string, config: WebToolkitCliConfig): void {
  const task = config.tasks[taskName]
  if (!task) {
    console.info(`Task "${taskName}" is not configured.`)
    return
  }

  console.info(task.title ?? `Task: ${taskName}`)
  console.info('')
  console.info('Steps:')
  for (const step of task.steps) {
    const command = step.builtinGuard ? `webtoolkit guard ${step.builtinGuard}` : step.command ?? '<builtin>'
    console.info(` - ${step.label}: ${command} ${(step.args ?? []).join(' ')}`.trim())
  }

  if (task.steps.some((step) => step.appendArgs)) {
    console.info('')
    console.info('Additional arguments are appended to steps marked with appendArgs.')
  }
}

export async function runTask(taskName: string, runtime: Runtime, passthroughArgs: string[] = []): Promise<void> {
  const task: TaskConfig | undefined = runtime.config.tasks[taskName]
  if (!task) {
    const available = listTaskCommands(runtime.config)
    throw new Error(
      available.length > 0
        ? `Task "${taskName}" is not configured. Available tasks: ${available.join(', ')}.`
        : `Task "${taskName}" is not configured.`,
    )
  }

  const failFast = task.failFast ?? true
  const defaultOutputMode = task.outputMode ?? 'inherit'
  let hasFailure = false

  console.info(task.title ?? `Running task: ${taskName}`)

  for (const step of task.steps) {
    const stepOutputMode = step.outputMode ?? defaultOutputMode
    if (hasFailure && failFast) {
      console.info(formatTaskStatusLine({
        action: getStepAction(step),
        label: step.label,
        status: 'SKIP',
        durationMs: 0,
      }))
      continue
    }

    const startLine = formatTaskStatusLine({
      action: getStepAction(step),
      label: step.label,
    })
    if (stepOutputMode === 'buffered') {
      process.stdout.write(startLine)
    } else {
      console.info('')
      console.info(startLine)
      console.info(`> ${step.label}`)
      const displayCommand = step.builtinGuard ? `webtoolkit guard ${step.builtinGuard}` : step.command ?? '<builtin>'
      console.info(`$ ${displayCommand} ${[...(step.args ?? []), ...(step.appendArgs ? normalizePassthroughArgs(passthroughArgs) : [])].join(' ')}`.trim())
    }

    const startedAt = Date.now()
    const outcome = await runStep(step, runtime, passthroughArgs, defaultOutputMode)
    const durationMs = Date.now() - startedAt

    if (outcome.code === 0) {
      const completedLine = formatTaskStatusLine({
        action: getStepAction(step),
        label: step.label,
        status: 'OK',
        durationMs,
      })
      if (stepOutputMode === 'buffered') {
        console.info(` ${colorizeResult('OK')} (${formatDuration(durationMs)})`)
      } else {
        console.info(completedLine)
      }
      continue
    }

    hasFailure = true
    const failedLine = formatTaskStatusLine({
      action: getStepAction(step),
      label: step.label,
      status: 'FALHA',
      durationMs,
    })
    if (stepOutputMode === 'buffered') {
      console.info(` ${colorizeResult('FALHA')} (${formatDuration(durationMs)})`)
    } else {
      console.info(failedLine)
    }
    if (outcome.output.trim()) {
      console.info('')
      console.info(outcome.output.trim())
    }
  }

  if (hasFailure) {
    throw new Error(`Task "${taskName}" failed.`)
  }
}
