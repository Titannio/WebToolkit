import type { TaskStepConfig, WebToolkitCliConfig } from './config.js'
import { formatCommand, runCommandInherited } from './process.js'
import { executeBuiltinGuard } from './guard-runner.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

type StepStatus = 'OK' | 'FAIL' | 'SKIP'

type CheckResult = {
  label: string
  status: StepStatus
  durationMs: number
}

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
}

function colorize(message: string, color: string): string {
  return `${color}${message}${colors.reset}`
}

function visibleLength(value: string): number {
  return value.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/gu, '').length
}

function padVisible(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - visibleLength(value)))}`
}

function buildAsciiTable(results: CheckResult[]): string {
  const rows = results.map((result) => [
    result.label,
    result.status === 'OK'
      ? colorize(result.status, colors.green)
      : result.status === 'FAIL'
        ? colorize(result.status, colors.red)
        : result.status,
    `${(result.durationMs / 1000).toFixed(2)}s`,
  ])
  const headers = [colorize('Etapa', colors.yellow), colorize('Status', colors.yellow), colorize('Duracao', colors.yellow)]
  const widths = headers.map((header, index) => Math.max(visibleLength(header), ...rows.map((row) => visibleLength(row[index]))))
  const separator = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`
  const formatRow = (row: string[]) => `| ${row.map((cell, index) => padVisible(cell, widths[index])).join(' | ')} |`

  return [
    separator,
    formatRow(headers),
    separator,
    ...rows.map(formatRow),
    separator,
  ].join('\n')
}

function runCheck(step: TaskStepConfig, runtime: Runtime): number {
  const args = step.args ?? []
  if (step.builtinGuard) {
    console.info('')
    console.info(colorize(`Step: ${step.label}`, `${colors.bright}${colors.blue}`))
    console.info(colorize(`> webtoolkit guard ${step.builtinGuard} ${args.join(' ')}`.trim(), colors.cyan))
    console.info('')

    return executeBuiltinGuard(step.builtinGuard, args, runtime.cwd)
  }

  if (!step.command) {
    throw new Error(`Repo check step "${step.label}" must define command or builtinGuard.`)
  }

  console.info('')
  console.info(colorize(`Step: ${step.label}`, `${colors.bright}${colors.blue}`))
  console.info(colorize(`> ${formatCommand(step.command, args)}`, colors.cyan))
  console.info('')

  return runCommandInherited({
    command: step.command,
    args,
    cwd: step.cwd,
    env: step.env,
  }, runtime.cwd)
}

export function runRepoCheck(runtime: Runtime): void {
  const config = runtime.config.repoCheck
  if (!config?.steps?.length) {
    throw new Error('repoCheck.steps is not configured.')
  }

  console.info(colorize(config.title ?? 'Starting Quality Assurance Checks...', `${colors.bright}${colors.yellow}`))

  const failFast = config.failFast ?? true
  const results: CheckResult[] = []
  let hasFailure = false

  try {
    for (const step of config.steps) {
      if (hasFailure && failFast) {
        results.push({ label: step.label, status: 'SKIP', durationMs: 0 })
        continue
      }

      const startedAt = Date.now()
      const code = runCheck(step, runtime)
      const durationMs = Date.now() - startedAt
      const status: StepStatus = code === 0 ? 'OK' : 'FAIL'

      results.push({ label: step.label, status, durationMs })

      if (status === 'OK') {
        console.info(colorize(`[OK] ${step.label}`, colors.green))
      } else {
        hasFailure = true
        console.error(`\n${colorize(`[FAIL] ${step.label} (exit code ${code})`, colors.red)}`)
      }
    }
  } catch (error) {
    hasFailure = true
    console.error(`\n${colorize(`Failed to execute checks: ${(error as Error).message}`, `${colors.bright}${colors.red}`)}`)
  }

  console.info('')
  console.info(colorize('ASCII Summary', `${colors.bright}${colors.cyan}`))
  console.info(buildAsciiTable(results))
  console.info('')

  if (hasFailure) {
    console.error(`\n${colorize('One or more checks failed. Please fix the errors above before proceeding.', `${colors.bright}${colors.red}`)}\n`)
    process.exit(1)
  }

  console.info(`\n${colorize('All checks passed successfully!', `${colors.bright}${colors.green}`)}\n`)
}
