#!/usr/bin/env node
// @ts-nocheck

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRepoRoot = process.cwd()

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
}

const buildPackages = [
  '@doutory/core',
  '@doutory/shared-logic',
  '@doutory/frontend-shared',
  'doutory-landing-framer',
  'doutory-frontend-user',
  'doutory-frontend-admin',
  'doutory-frontend-operations',
  'doutory-backend',
]

const targetDefinitions = {
  backend: {
    warningTitle: 'Rebuild recommended before starting Doutory Backend',
    turboFilters: ['doutory-backend'],
    relevantBuildPackages: ['@doutory/core', '@doutory/shared-logic'],
  },
  'frontend-user': {
    warningTitle: 'Rebuild recommended before starting Doutory Frontend (User App)',
    turboFilters: ['doutory-frontend-user'],
    relevantBuildPackages: ['@doutory/core', '@doutory/shared-logic'],
  },
  'frontend-admin': {
    warningTitle: 'Rebuild recommended before starting Doutory Frontend (Admin App)',
    turboFilters: ['doutory-frontend-admin'],
    relevantBuildPackages: ['@doutory/core', '@doutory/shared-logic'],
  },
  'frontend-operations': {
    warningTitle: 'Rebuild recommended before starting Doutory Frontend (Operations App)',
    turboFilters: ['doutory-frontend-operations'],
    relevantBuildPackages: ['@doutory/core', '@doutory/shared-logic'],
  },
  'landing-framer': {
    warningTitle: 'Rebuild recommended before starting Doutory Landing Framer',
    turboFilters: ['doutory-landing-framer'],
    relevantBuildPackages: [],
  },
  validate: {
    warningTitle: 'Rebuild recommended after validation',
    turboFilters: buildPackages,
    relevantBuildPackages: buildPackages,
  },
}

function colorize(message, color) {
  return `${color}${message}${colors.reset}`
}

function quoteShellArg(arg) {
  if (/^[\w@%+=:,./\\-]+$/.test(arg)) {
    return arg
  }

  return `"${arg.replace(/"/g, '\\"')}"`
}

export function getTargetDefinition(target) {
  const definition = targetDefinitions[target]
  if (!definition) {
    throw new Error(
      `Unknown rebuild preflight target: ${target}. Expected one of ${Object.keys(targetDefinitions).join(', ')}`,
    )
  }

  return definition
}

export function parseTurboDryRun(stdout) {
  const trimmed = stdout.trim()
  if (!trimmed) {
    throw new Error('Turbo dry run produced no JSON output')
  }

  return JSON.parse(trimmed)
}

export function extractPackagesNeedingRebuild(report, relevantBuildPackages) {
  const relevantPackages = new Set(relevantBuildPackages)

  return report.tasks
    .filter((task) => task.task === 'build')
    .filter((task) => task.command !== '<NONEXISTENT>')
    .filter((task) => relevantPackages.size === 0 || relevantPackages.has(task.package))
    .filter((task) => task.cache?.status !== 'HIT')
    .map((task) => task.package)
}

function runTurboBuildDryRun({ repoRoot, turboFilters }) {
  const args = ['turbo', 'run', 'build', '--dry=json']
  for (const filter of turboFilters) {
    args.push(`--filter=${filter}`)
  }

  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', ['pnpm', ...args].map(quoteShellArg).join(' ')], {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, FORCE_COLOR: '1' },
        })
      : spawnSync('pnpm', args, {
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

export function getRebuildPreflightReport({
  repoRoot = defaultRepoRoot,
  target,
} = {}) {
  const definition = getTargetDefinition(target)

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

export function formatRebuildPreflightWarning(report) {
  if (report.packagesNeedingRebuild.length === 0) {
    return ''
  }

  const packageNames = report.packagesNeedingRebuild.join(', ')
  return `${colorize(`[DEV PRECHECK] ${report.warningTitle}: ${packageNames}`, colors.red)}\n`
}

export function printRebuildPreflightWarning(options = {}) {
  const report = getRebuildPreflightReport(options)
  const warning = formatRebuildPreflightWarning(report)

  if (warning) {
    process.stderr.write(warning)
  }

  return report
}

function getTargetFromArgv(argv = process.argv) {
  const targetArg = argv.find((arg) => arg.startsWith('--target='))
  return targetArg ? targetArg.slice('--target='.length) : null
}

function main() {
  const target = getTargetFromArgv()

  if (!target) {
    process.stderr.write(
      colorize('[DEV PRECHECK] Missing --target=<name>; skipping rebuild warning.\n', colors.yellow),
    )
    process.exit(0)
  }

  try {
    printRebuildPreflightWarning({ target })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(
      colorize(`[DEV PRECHECK] Warning check failed: ${message}\n`, colors.yellow),
    )
  }

  process.exit(0)
}

const isMainModule = process.argv[1] === __filename
if (isMainModule) {
  main()
}
