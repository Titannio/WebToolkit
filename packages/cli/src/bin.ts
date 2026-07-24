#!/usr/bin/env node
import path from 'node:path'

import { loadConfig } from './config.js'
import { runConfigReference } from './config-reference.js'
import { runBundleAudit } from './bundle-audit.js'
import { parseCleanArgs, printCleanHelp, runCleaner } from './cleaner.js'
import { runDevGrid } from './dev-grid.js'
import { runDevWatch } from './dev-watch.js'
import { runEnvBootstrap, runEnvDoctor } from './environment.js'
import { printGuardHelp, runBuiltinGuard } from './guard-runner.js'
import { runJSDocReport } from './jsdoc-report.js'
import { runReadyService } from './ready-service.js'
import { runRepoCheck } from './repo-check.js'
import { runReleaseGate } from './release-gate.js'
import { listTaskCommands, printTaskHelp, resolveTaskName, runTask } from './tasks.js'
import { runUpgradeEngine } from './upgrade.js'
import { runValidateEngine } from './validate.js'
import { runWorkspaceCoverage, runWorkspaceTests, runWorkspaceTestTask } from './workspace-tests.js'

function printHelp(taskNames: string[] = []): void {
  console.info('Usage: webtoolkit <command> [options]')
  console.info('')
  console.info('Commands:')
  console.info('  clean                         Remove cache, build, and temporary artifacts.')
  console.info('  check                         Run the configured check task.')
  console.info('  build                         Run the configured build task.')
  console.info('  test                          Run the configured test task.')
  console.info('  test-coverage                 Run the configured coverage task.')
  console.info('  workspace-test <task>         Run a workspace-local Vitest task.')
  console.info('  release-gate                  Run the configured release gate task.')
  console.info('  validate                      Run the configured validation task.')
  console.info('  jsdoc-report                  Run the configured JSDoc report task.')
  console.info('  upgrade                       Run the configured upgrade task.')
  console.info('  performance-bundle-audit      Run the configured bundle audit task.')
  console.info('  dev-watch                     Run configured dev app watcher.')
  console.info('  dev-grid                      Open configured dev terminal grid.')
  console.info('  wait-service                  Wait for a service readiness endpoint.')
  console.info('  env-bootstrap                 Prepare configured Node/Corepack environment.')
  console.info('  env-doctor                    Validate configured Node/Corepack environment.')
  console.info('  config [--help|--json]        Show .webtoolkit-cli/config.json reference.')
  console.info('  guard <name>                  Run a builtin guard engine.')
  console.info('  run:<task>                    Run any configured task by name.')
  if (taskNames.length > 0) {
    console.info('')
    console.info(`Configured tasks: ${taskNames.join(', ')}`)
  }
  console.info('')
  console.info('Run `webtoolkit <command> --help` for command-specific options.')
}

function hasHelp(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h')
}

function printEngineHelp(command: string): void {
  const help: Record<string, string[]> = {
    test: [
      'Usage: webtoolkit test [test files...] [--filter <workspace/package>] [vitest args]',
      'Runs configured workspace tests.',
    ],
    'test-coverage': [
      'Usage: webtoolkit test-coverage [--filter <workspace/package>]',
      'Runs configured workspace coverage tasks.',
    ],
    check: [
      'Usage: webtoolkit check',
      'Runs configured repository quality checks.',
    ],
    'release-gate': [
      'Usage: webtoolkit release-gate [stage...]',
      'Runs configured critical release gate stages.',
    ],
    validate: [
      'Usage: webtoolkit validate',
      'Runs configured validation steps.',
    ],
    'jsdoc-report': [
      'Usage: webtoolkit jsdoc-report [files...] [--write|--report|--no-report]',
      'Analyzes configured TypeScript paths for JSDoc coverage.',
    ],
    upgrade: [
      'Usage: webtoolkit upgrade [--yes] [--major] [--no-cooldown] [--days=N] [--isolated] [--verbose]',
      'Runs configured dependency upgrade workflow.',
    ],
    'performance-bundle-audit': [
      'Usage: webtoolkit performance-bundle-audit [--top N] [--root path]',
      'Audits configured frontend build assets.',
    ],
    'dev-watch': [
      'Usage: webtoolkit dev-watch [--apps=a,b] [--check-only] [--include-backend] [--silent]',
      'Runs configured frontend dev watchers and port preflight.',
    ],
    'dev-grid': [
      'Usage: webtoolkit dev-grid [--silent] [--dry-run]',
      'Opens the configured Windows Terminal dev grid.',
    ],
    'wait-service': [
      'Usage: webtoolkit wait-service [--url URL] [--name Name] [--timeout-ms N|never] [--interval-ms N] [--skip-ready-check]',
      'Waits for a service /ready endpoint.',
    ],
    'env-bootstrap': [
      'Usage: webtoolkit env-bootstrap',
      'Prepares the configured Node/Corepack/package-manager environment.',
    ],
    'env-doctor': [
      'Usage: webtoolkit env-doctor',
      'Validates the configured Node/Corepack/package-manager environment.',
    ],
  }

  for (const line of help[command] ?? [`No help available for ${command}.`]) {
    console.info(line)
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)

  if (command === 'config') {
    runConfigReference(args)
    return
  }

  const { config, configPath } = await loadConfig(process.cwd())
  const workspaceRoot = configPath ? path.dirname(path.dirname(configPath)) : process.cwd()

  if (!command || command === '--help' || command === '-h') {
    printHelp(listTaskCommands(config))
    return
  }

  if (command === 'clean') {
    const options = parseCleanArgs(args)
    await runCleaner(options, { cwd: workspaceRoot, config })
    return
  }

  if (command === 'clean-help') {
    printCleanHelp()
    return
  }

  if (command === 'guard') {
    const [guardName, ...guardArgs] = args
    if (!guardName || hasHelp(args)) {
      printGuardHelp()
      return
    }
    runBuiltinGuard(guardName, guardArgs, process.cwd())
    return
  }

  if (command === 'test' && config.workspaceTests) {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    await runWorkspaceTests({ cwd: workspaceRoot, config }, args)
    return
  }

  if (command === 'check' && config.repoCheck) {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    runRepoCheck({ cwd: workspaceRoot, config })
    return
  }

  if (command === 'test-coverage' && config.workspaceTests) {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    await runWorkspaceCoverage({ cwd: workspaceRoot, config }, args)
    return
  }

  if (command === 'workspace-test') {
    const [taskName, ...extraArgs] = args
    if (!taskName || hasHelp(args)) {
      console.info('Usage: webtoolkit workspace-test <test|test:coverage> [vitest args]')
      return
    }
    runWorkspaceTestTask({ cwd: workspaceRoot, config }, taskName, extraArgs)
    return
  }

  if (command === 'release-gate' && config.releaseGate) {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    runReleaseGate({ cwd: workspaceRoot, config }, args)
    return
  }

  if (command === 'validate' && config.validate) {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    await runValidateEngine({ cwd: workspaceRoot, config })
    return
  }

  if (command === 'jsdoc-report' && config.jsdocReport) {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    await runJSDocReport({ cwd: workspaceRoot, config }, args)
    return
  }

  if (command === 'upgrade' && config.upgrade) {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    await runUpgradeEngine({ cwd: workspaceRoot, config }, args)
    return
  }

  if (command === 'performance-bundle-audit' && config.bundleAudit) {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    runBundleAudit({ cwd: workspaceRoot, config }, args)
    return
  }

  if (command === 'dev-watch' && config.devWatch) {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    await runDevWatch({ cwd: workspaceRoot, config }, args)
    return
  }

  if (command === 'dev-grid' && config.devGrid) {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    runDevGrid({ cwd: workspaceRoot, config }, args)
    return
  }

  if (command === 'wait-service') {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    await runReadyService({ cwd: workspaceRoot, config }, args)
    return
  }

  if (command === 'env-bootstrap') {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    runEnvBootstrap({ cwd: workspaceRoot, config })
    return
  }

  if (command === 'env-doctor') {
    if (hasHelp(args)) {
      printEngineHelp(command)
      return
    }
    runEnvDoctor({ cwd: workspaceRoot, config })
    return
  }

  const taskName = resolveTaskName(command)
  if (taskName) {
    if (hasHelp(args)) {
      printTaskHelp(taskName, config)
      return
    }
    await runTask(taskName, { cwd: workspaceRoot, config }, args)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exit(1)
})
