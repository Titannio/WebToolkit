#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import type { RebuildPreflightTargetConfig } from '../config.js'
import { loadConfig } from '../config.js'
import { isMainModule } from './guard-config.js'

const defaultRepoRoot = process.cwd()

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
}

type TurboTask = {
  task: string
  command: string
  package: string
  cache?: { status?: string }
}

type TurboDryRunReport = {
  tasks: TurboTask[]
}

export type RebuildPreflightReport = {
  target: string
  warningTitle: string
  packagesNeedingRebuild: string[]
}

type RebuildPreflightOptions = {
  repoRoot?: string
  target: string
}

function colorize(message: string, color: string): string {
  return `${color}${message}${colors.reset}`
}

function quoteShellArg(arg: string): string {
  if (/^[\w@%+=:,./\\-]+$/.test(arg)) {
    return arg
  }

  return `"${arg.replace(/"/g, '\\"')}"`
}

export function getTargetDefinition(
  target: string,
  targetDefinitions: Record<string, RebuildPreflightTargetConfig>,
): RebuildPreflightTargetConfig {
  const definition = targetDefinitions[target]
  if (!definition) {
    throw new Error(
      `Unknown rebuild preflight target: ${target}. Expected one of ${Object.keys(targetDefinitions).join(', ')}`,
    )
  }

  return definition
}

export function parseTurboDryRun(stdout: string): TurboDryRunReport {
  const trimmed = stdout.trim()
  if (!trimmed) {
    throw new Error('Turbo dry run produced no JSON output')
  }

  return JSON.parse(trimmed) as TurboDryRunReport
}

export function extractPackagesNeedingRebuild(
  report: TurboDryRunReport,
  relevantBuildPackages: string[],
): string[] {
  const relevantPackages = new Set(relevantBuildPackages)

  return report.tasks
    .filter((task) => task.task === 'build')
    .filter((task) => task.command !== '<NONEXISTENT>')
    .filter((task) => relevantPackages.size === 0 || relevantPackages.has(task.package))
    .filter((task) => task.cache?.status !== 'HIT')
    .map((task) => task.package)
}

function runTurboBuildDryRun(options: {
  repoRoot: string
  turboFilters: string[]
  packageManager: string
}): TurboDryRunReport {
  const { repoRoot, turboFilters, packageManager } = options
  const args = ['turbo', 'run', 'build', '--dry=json']
  for (const filter of turboFilters) {
    args.push(`--filter=${filter}`)
  }

  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', [packageManager, ...args].map(quoteShellArg).join(' ')], {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, FORCE_COLOR: '1' },
        })
      : spawnSync(packageManager, args, {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, FORCE_COLOR: '1' },
        })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const details = result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status}`
    throw new Error(`Turbo dry run failed: ${details}`)
  }

  return parseTurboDryRun(result.stdout)
}

export async function getRebuildPreflightReport({
  repoRoot = defaultRepoRoot,
  target,
}: RebuildPreflightOptions): Promise<RebuildPreflightReport> {
  const { config } = await loadConfig(repoRoot)
  const targetDefinitions = config.guards?.rebuildPreflight?.targets
  if (!targetDefinitions || Object.keys(targetDefinitions).length === 0) {
    throw new Error('guards.rebuildPreflight.targets is not configured in .webtoolkit-cli/config.json.')
  }
  const definition = getTargetDefinition(target, targetDefinitions)

  if (definition.relevantBuildPackages.length === 0) {
    return {
      target,
      warningTitle: definition.warningTitle,
      packagesNeedingRebuild: [],
    }
  }

  const turboReport = runTurboBuildDryRun({
    repoRoot,
    turboFilters: definition.turboFilters,
    packageManager: config.packageManager,
  })

  return {
    target,
    warningTitle: definition.warningTitle,
    packagesNeedingRebuild: extractPackagesNeedingRebuild(
      turboReport,
      definition.relevantBuildPackages,
    ),
  }
}

export function formatRebuildPreflightWarning(report: RebuildPreflightReport): string {
  if (report.packagesNeedingRebuild.length === 0) {
    return ''
  }

  const packageNames = report.packagesNeedingRebuild.join(', ')
  return `${colorize(`[DEV PRECHECK] ${report.warningTitle}: ${packageNames}`, colors.red)}\n`
}

export async function printRebuildPreflightWarning(
  options: RebuildPreflightOptions,
): Promise<RebuildPreflightReport> {
  const report = await getRebuildPreflightReport(options)
  const warning = formatRebuildPreflightWarning(report)

  if (warning) {
    process.stderr.write(warning)
  }

  return report
}

/* v8 ignore start -- executable adapter */
function getTargetFromArgv(argv = process.argv): string | null {
  const targetArg = argv.find((arg) => arg.startsWith('--target='))
  return targetArg ? targetArg.slice('--target='.length) : null
}

async function main(): Promise<void> {
  const target = getTargetFromArgv()

  if (!target) {
    process.stderr.write(
      colorize('[DEV PRECHECK] Missing --target=<name>; skipping rebuild warning.\n', colors.yellow),
    )
    process.exit(0)
  }

  try {
    await printRebuildPreflightWarning({ target })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(
      colorize(`[DEV PRECHECK] Warning check failed: ${message}\n`, colors.yellow),
    )
  }

  process.exit(0)
}
/* v8 ignore stop */

/* v8 ignore start -- executable adapter */
if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(colorize(`[DEV PRECHECK] Warning check failed: ${message}\n`, colors.yellow))
  })
}
/* v8 ignore stop */
