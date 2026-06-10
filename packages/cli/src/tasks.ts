import { spawn } from 'node:child_process'
import path from 'node:path'

import type { TaskConfig, TaskStepConfig, WebToolkitCliConfig } from './config.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

type TaskResult = {
  label: string
  status: 'OK' | 'FAIL' | 'SKIP'
  durationMs: number
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
    throw new Error(`Task step "${step.label}" must define command.`)
  }

  if (process.platform !== 'win32') {
    return { command: step.command, args, shell: false }
  }

  if (step.command === 'node' || step.command === process.execPath) {
    return { command: step.command, args, shell: false }
  }

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', step.command, ...args],
    shell: false,
  }
}

function runStep(step: TaskStepConfig, runtime: Runtime, passthroughArgs: string[]): Promise<{ code: number; output: string }> {
  const args = [...(step.args ?? []), ...(step.appendArgs ? normalizePassthroughArgs(passthroughArgs) : [])]
  const resolved = resolveCommand(step, args)
  const outputMode = step.outputMode ?? 'inherit'
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

function printSummary(results: TaskResult[]): void {
  console.info('')
  console.info('Summary')
  for (const result of results) {
    console.info(` - ${result.status.padEnd(4)} ${result.label} (${formatDuration(result.durationMs)})`)
  }
  console.info('')
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
    console.info(` - ${step.label}: ${step.command ?? '<builtin>'} ${(step.args ?? []).join(' ')}`.trim())
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
  const results: TaskResult[] = []
  let hasFailure = false

  console.info(task.title ?? `Running task: ${taskName}`)

  for (const step of task.steps) {
    if (hasFailure && failFast) {
      results.push({ label: step.label, status: 'SKIP', durationMs: 0 })
      continue
    }

    console.info('')
    console.info(`> ${step.label}`)
    console.info(`$ ${step.command ?? '<builtin>'} ${[...(step.args ?? []), ...(step.appendArgs ? normalizePassthroughArgs(passthroughArgs) : [])].join(' ')}`.trim())

    const startedAt = Date.now()
    const outcome = await runStep(step, runtime, passthroughArgs)
    const durationMs = Date.now() - startedAt

    if (outcome.code === 0) {
      results.push({ label: step.label, status: 'OK', durationMs })
      continue
    }

    hasFailure = true
    results.push({ label: step.label, status: 'FAIL', durationMs })
    if (outcome.output.trim()) {
      console.info('')
      console.info(outcome.output.trim())
    }
  }

  printSummary(results)

  if (hasFailure) {
    throw new Error(`Task "${taskName}" failed.`)
  }
}
