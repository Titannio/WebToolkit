import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

import type { WebToolkitCliConfig, WorkspaceTargetConfig } from './config.js'
import { buildPackageManagerCommand } from './process.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

type WorkspaceResult = {
  target: WorkspaceTargetConfig
  command: string
  duration: string
  exitCode: number
  outputBuffer: string
  failed: boolean
  failedFiles: number
  failedTests: number
  failedFilesDetected: boolean
  failedTestsDetected: boolean
  skipped?: boolean
}

const defaultTestFilePattern = '\\.(test|spec)\\.(ts|tsx|js|jsx)$'
const defaultIgnoreDirNames = ['node_modules', 'dist', '.git']

function getWorkspaceConfig(config: WebToolkitCliConfig) {
  if (!config.workspaceTests?.workspaces?.length) {
    throw new Error('workspaceTests.workspaces is not configured.')
  }

  return config.workspaceTests
}

function countTestFiles(dirPath: string, pattern: RegExp, ignoreDirNames: Set<string>): number {
  let count = 0
  if (!fs.existsSync(dirPath)) return 0

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (!ignoreDirNames.has(entry.name)) {
        count += countTestFiles(fullPath, pattern, ignoreDirNames)
      }
    } else if (entry.isFile() && pattern.test(entry.name)) {
      count += 1
    }
  }

  return count
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function normalizeReportLine(line: string): string {
  return line.replace(/^(?:@[\w.-]+\/)?[\w.-]+:[\w:-]+:\s*/, '').trimEnd()
}

function findFailedTestsSectionStartIndex(lines: string[]): number {
  return lines.findIndex((line) => /-+\s*Failed Tests\b/i.test(line.trim()) || /⎯+\s*Failed Tests\b/i.test(line.trim()))
}

function isFailureStartLine(line: string): boolean {
  return /\bFailed Tests\s+\d+/i.test(line) || /^\s*FAIL\s+/.test(line) || /^\s*[×✕✖]\s+/.test(line)
}

function isFailureSummaryLine(line: string): boolean {
  return /^\s*Test Files\s+/i.test(line) ||
    /^\s*Tests\s+/i.test(line) ||
    /^\s*Start at\s+/i.test(line) ||
    /^\s*Duration\s+/i.test(line) ||
    /^\s*\[ELIFECYCLE\]/i.test(line) ||
    /\bERROR\b.*(?:exited|run failed)/i.test(line)
}

function isFailureLogNoiseLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  return /^✓\s+/.test(trimmed) ||
    /^✔\s+/.test(trimmed) ||
    /^◇\s+injected env/i.test(trimmed) ||
    /^Packages in scope:/i.test(trimmed) ||
    /^Running test in /i.test(trimmed) ||
    /^Remote caching disabled/i.test(trimmed) ||
    /^cache (hit|miss)/i.test(trimmed) ||
    /^replaying logs/i.test(trimmed) ||
    /^executing /i.test(trimmed) ||
    /^\$\s+/.test(trimmed) ||
    /^Could not parse CSS stylesheet$/i.test(trimmed) ||
    /was not wrapped in act\(\.\.\.\)/i.test(trimmed)
}

function clampFailureExcerptLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines
  const headCount = Math.floor(maxLines * 0.65)
  const tailCount = maxLines - headCount - 1
  return [
    ...lines.slice(0, headCount),
    `... omitted ${lines.length - headCount - tailCount} noisy/verbose failure lines ...`,
    ...lines.slice(-tailCount),
  ]
}

function extractFailureExcerpt(outputBuffer: string, maxLines: number): string[] {
  const lines = stripAnsi(outputBuffer).split(/\r?\n/).map(normalizeReportLine)
  const failedTestsSectionStartIndex = findFailedTestsSectionStartIndex(lines)

  if (failedTestsSectionStartIndex >= 0) {
    return clampFailureExcerptLines(
      lines.slice(failedTestsSectionStartIndex).filter((line) => !isFailureLogNoiseLine(line)),
      maxLines,
    )
  }

  const excerpt: string[] = []
  let capturingFailure = false
  let summaryTailLines: number | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (isFailureStartLine(trimmed) || trimmed.includes('[runner-error]')) {
      capturingFailure = true
      summaryTailLines = null
    }
    if ((capturingFailure || isFailureSummaryLine(trimmed)) && !isFailureLogNoiseLine(trimmed)) {
      excerpt.push(line)
    }
    if (capturingFailure && /^\s*Test Files\s+/i.test(trimmed)) {
      summaryTailLines = 8
      continue
    }
    if (summaryTailLines !== null) {
      summaryTailLines -= 1
      if (summaryTailLines <= 0) {
        capturingFailure = false
        summaryTailLines = null
      }
    }
  }

  return clampFailureExcerptLines(excerpt.length > 0 ? excerpt : lines.filter((line) => !isFailureLogNoiseLine(line)).slice(-80), maxLines)
}

function parseFailureSummary(outputBuffer: string, code: number, hasFailure: boolean) {
  const cleanOutput = stripAnsi(outputBuffer)
  const summary = {
    failedFiles: 0,
    failedTests: 0,
    failedFilesDetected: false,
    failedTestsDetected: false,
  }

  for (const line of cleanOutput.split(/\r?\n/)) {
    const testFilesMatch = line.match(/Test Files\s+([^\n\r]+)/i)
    if (testFilesMatch) {
      const failedMatch = testFilesMatch[1].match(/(\d+)\s+failed/i)
      if (failedMatch) {
        summary.failedFiles = Number.parseInt(failedMatch[1], 10)
        summary.failedFilesDetected = true
      }
    }

    const testsMatch = line.match(/(?:^|:\s*)Tests\s+([^\n\r]+)/i)
    if (testsMatch) {
      const failedMatch = testsMatch[1].match(/(\d+)\s+failed/i)
      if (failedMatch) {
        summary.failedTests = Number.parseInt(failedMatch[1], 10)
        summary.failedTestsDetected = true
      }
    }
  }

  if ((code !== 0 || hasFailure) && !summary.failedFilesDetected) {
    summary.failedFiles = 1
  }

  return summary
}

export function formatFailureSummary(summary: Pick<WorkspaceResult, 'failedFiles' | 'failedTests' | 'failedTestsDetected'>): string {
  const fileLabel = summary.failedFiles === 1 ? '1 arquivo' : `${summary.failedFiles} arquivos`
  if (!summary.failedTestsDetected) {
    return `falhas nao detectadas em ${fileLabel}`
  }

  const failureLabel = summary.failedTests === 1 ? '1 falha' : `${summary.failedTests} falhas`

  return `${failureLabel} em ${fileLabel}`
}

type WorkspaceTestStatusLineOptions =
  | {
    failed: true
    duration: string
    summary: Pick<WorkspaceResult, 'failedFiles' | 'failedTests' | 'failedTestsDetected'>
  }
  | {
    failed: false
    duration: string
  }

export function formatWorkspaceTestStatusLine(options: WorkspaceTestStatusLineOptions): string {
  if (options.failed) {
    return `\x1b[31mERRO\x1b[0m - ${formatFailureSummary(options.summary)} (${options.duration}s)`
  }

  return `\x1b[32mOK\x1b[0m (${options.duration}s)`
}

export function progressBlockHasFailure(index: number, width: number, total: number, results: boolean[]): boolean {
  const safeTotal = Math.max(total, 1)
  const start = Math.floor((index * safeTotal) / width)
  const end = Math.ceil(((index + 1) * safeTotal) / width)

  for (let resultIndex = start; resultIndex < end && resultIndex < results.length; resultIndex += 1) {
    if (results[resultIndex] === false) return true
  }

  return false
}

function drawProgressBar(label: string, name: string, completed: number, total: number, results: boolean[], coverage: number | null = null): void {
  const safeTotal = Math.max(total, 1)
  const safeCompleted = Math.min(Math.max(completed, 0), safeTotal)
  const width = label === 'Coverage' ? 40 : 60
  const percentage = Math.min(Math.floor((safeCompleted / safeTotal) * 100), 100)
  const filledChars = Math.min(Math.floor((safeCompleted / safeTotal) * width), width)
  let barStr = ''

  for (let index = 0; index < width; index += 1) {
    if (index < filledChars) {
      const failed = progressBlockHasFailure(index, width, safeTotal, results)
      barStr += `${failed ? '\x1b[31m' : '\x1b[32m'}█\x1b[0m`
    } else {
      barStr += '\x1b[90m░\x1b[0m'
    }
  }

  const coverageText = coverage === null
    ? ''
    : ` | Coverage: ${(coverage >= 80 ? '\x1b[32m' : coverage >= 50 ? '\x1b[33m' : '\x1b[31m')}${coverage.toFixed(1)}%\x1b[0m`
  process.stdout.write(`\r- ${label} \x1b[1m${name.padEnd(10)}\x1b[0m [${barStr}] ${percentage}% (${safeCompleted}/${total})${coverageText} `)
}

function parseTestFileLine(line: string): { filePath: string; isSuccess: boolean } | null {
  const cleanLine = stripAnsi(line)
  const match = cleanLine.match(/(✓|×|✕|✖|FAIL|PASS|failed|passed)\s+(.+?(\.test\.|\.spec\.)[a-zA-Z]+)/i)
  if (!match) return null
  const status = match[1].toUpperCase()
  return {
    filePath: match[2].trim(),
    isSuccess: status === '✓' || status.includes('PASS'),
  }
}

function resolveTargets(runtime: Runtime, rawArgs: string[]): WorkspaceTargetConfig[] {
  const testConfig = getWorkspaceConfig(runtime.config)
  let targets = testConfig.workspaces
  const filterValue = getFilterValue(rawArgs)

  if (filterValue) {
    targets = targets.filter((target) => target.package === filterValue || target.name.toLowerCase() === filterValue.toLowerCase())
  } else if (process.env.INIT_CWD) {
    const initCwd = path.resolve(process.env.INIT_CWD)
    const matched = targets.find((target) => path.resolve(runtime.cwd, target.path) === initCwd)
    if (matched) targets = [matched]
  }

  return targets
}

async function runWorkspaceTest(target: WorkspaceTargetConfig, runtime: Runtime): Promise<WorkspaceResult> {
  const testConfig = getWorkspaceConfig(runtime.config)
  const pattern = new RegExp(testConfig.testFilePattern ?? defaultTestFilePattern)
  const ignoreDirNames = new Set(testConfig.ignoreDirNames ?? defaultIgnoreDirNames)
  const absPath = path.join(runtime.cwd, target.path)
  const totalFiles = countTestFiles(absPath, pattern, ignoreDirNames)

  process.stdout.write(`- Testing \x1b[1m${target.name.padEnd(10)}\x1b[0m Preparando...`)
  if (totalFiles === 0) {
    console.info(`\r- Testing \x1b[1m${target.name.padEnd(10)}\x1b[0m \x1b[33mSKIPPED (No tests found)\x1b[0m      `)
    return {
      target,
      skipped: true,
      command: '',
      duration: '0.0',
      exitCode: 0,
      outputBuffer: '',
      failed: false,
      failedFiles: 0,
      failedTests: 0,
      failedFilesDetected: true,
      failedTestsDetected: true,
    }
  }

  const results: boolean[] = []
  const processedFiles = new Set<string>()
  let hasFailure = false
  let outputBuffer = ''
  const startedAt = Date.now()
  const commandSpec = buildPackageManagerCommand(runtime.config.packageManager, ['turbo', 'run', 'test', '--filter', target.package, '--', '--reporter=verbose'])
  const commandText = `${commandSpec.command} ${(commandSpec.args ?? []).join(' ')}`

  drawProgressBar('Testing', target.name, 0, totalFiles, results)

  return await new Promise((resolve) => {
    let finished = false
    const finish = (code: number | null) => {
      if (finished) return
      finished = true

      const duration = ((Date.now() - startedAt) / 1000).toFixed(1)
      const exitCode = code ?? 1
      const summary = parseFailureSummary(outputBuffer, exitCode, hasFailure)
      const failed = exitCode !== 0 || hasFailure
      if (failed && !results.includes(false)) {
        results[Math.max(0, Math.min(totalFiles, Math.max(results.length, 1)) - 1)] = false
      }
      drawProgressBar('Testing', target.name, totalFiles, totalFiles, results)

      console.info(formatWorkspaceTestStatusLine(failed
        ? { failed, duration, summary }
        : { failed, duration }))

      resolve({ target, command: commandText, duration, exitCode, outputBuffer, failed, ...summary })
    }

    const child = spawn(commandSpec.command, commandSpec.args ?? [], {
      cwd: runtime.cwd,
      env: { ...process.env, FORCE_COLOR: '1', CI: '1', NODE_OPTIONS: '--no-deprecation' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      outputBuffer += text
      for (const line of text.split(/\r?\n/)) {
        const parsedLine = parseTestFileLine(line)
        if (!parsedLine || processedFiles.has(parsedLine.filePath)) continue
        processedFiles.add(parsedLine.filePath)
        if (!parsedLine.isSuccess) hasFailure = true
        results.push(parsedLine.isSuccess)
        drawProgressBar('Testing', target.name, processedFiles.size, totalFiles, results)
      }
    })
    child.stderr.on('data', (data: Buffer) => {
      outputBuffer += data.toString()
    })
    child.on('error', (error) => {
      hasFailure = true
      outputBuffer += `\n[runner-error] ${error.stack || error.message}\n`
      finish(1)
    })
    child.on('close', finish)
  })
}

function buildErrorLog(results: WorkspaceResult[], runtime: Runtime): string {
  const failedResults = results.filter((result) => result.failed)
  if (failedResults.length === 0) return ''
  const testConfig = getWorkspaceConfig(runtime.config)
  const maxLines = testConfig.maxFailureExcerptLines ?? 280
  const sections = [
    'Workspace test failure report',
    `Generated at: ${new Date().toISOString()}`,
    `Root: ${runtime.cwd}`,
    `Failed workspaces: ${failedResults.length}`,
    '',
  ]

  for (const result of failedResults) {
    sections.push('='.repeat(100))
    sections.push(`Workspace: ${result.target.name} (${result.target.package})`)
    sections.push(`Command: ${result.command}`)
    sections.push(`Exit code: ${result.exitCode}`)
    sections.push(`Duration: ${result.duration}s`)
    sections.push(`Failed files: ${result.failedFiles}${result.failedFilesDetected ? '' : ' (fallback)'}`)
    sections.push(`Failed tests: ${result.failedTestsDetected ? result.failedTests : 'not detected'}`)
    sections.push('-'.repeat(100))
    sections.push('Failure excerpt (noise-filtered):')
    sections.push(...extractFailureExcerpt(result.outputBuffer, maxLines))
    sections.push('')
  }

  return `${sections.join('\n')}\n`
}

export async function runWorkspaceTests(runtime: Runtime, rawArgs: string[]): Promise<void> {
  const testConfig = getWorkspaceConfig(runtime.config)
  const { testFiles, extraArgs } = splitArgs(rawArgs)

  if (testFiles.length > 0) {
    runMultipleWorkspaceTestFiles(runtime, testFiles, extraArgs)
    return
  }

  console.info('\nIniciando bateria completa de testes...\n')
  const errorLogPath = path.join(runtime.cwd, testConfig.errorLogFile ?? 'tests_output_errors.log')
  fs.rmSync(errorLogPath, { force: true })

  const results: WorkspaceResult[] = []
  for (const target of resolveTargets(runtime, rawArgs)) {
    results.push(await runWorkspaceTest(target, runtime))
  }

  const failedResults = results.filter((result) => result.failed)
  if (failedResults.length > 0) {
    fs.writeFileSync(errorLogPath, buildErrorLog(results, runtime), 'utf8')
    console.info('\n\x1b[31mResumo de falhas:\x1b[0m')
    for (const result of failedResults) {
      console.info(`- ${result.target.name}: ${formatFailureSummary(result)}`)
    }
    console.info(`\nDetalhes consolidados em ${path.relative(runtime.cwd, errorLogPath)}`)
    throw new Error('Workspace tests failed.')
  }

  console.info('\n\x1b[32m✔ Todos os testes passaram com sucesso!\x1b[0m')
}

export async function runWorkspaceCoverage(runtime: Runtime, rawArgs: string[]): Promise<void> {
  const testConfig = getWorkspaceConfig(runtime.config)
  const pattern = new RegExp(testConfig.testFilePattern ?? defaultTestFilePattern)
  const ignoreDirNames = new Set(testConfig.ignoreDirNames ?? defaultIgnoreDirNames)
  console.info('\nIniciando bateria completa de cobertura de testes...\n')

  for (const target of resolveTargets(runtime, rawArgs)) {
    const totalFiles = countTestFiles(path.join(runtime.cwd, target.path), pattern, ignoreDirNames)
    process.stdout.write(`- Coverage \x1b[1m${target.name.padEnd(10)}\x1b[0m Preparando...`)
    if (totalFiles === 0) {
      console.info(`\r- Coverage \x1b[1m${target.name.padEnd(10)}\x1b[0m \x1b[33mSKIPPED (No tests found)\x1b[0m      `)
      continue
    }

    const startedAt = Date.now()
    const commandSpec = buildPackageManagerCommand(runtime.config.packageManager, ['turbo', 'run', 'test:coverage', '--filter', target.package])
    let processedFiles = 0
    let totalCoverage: number | null = null
    let outputBuffer = ''
    const results: boolean[] = []
    drawProgressBar('Coverage', target.name, 0, totalFiles, results, totalCoverage)

    const code = await new Promise<number>((resolve) => {
      const child = spawn(commandSpec.command, commandSpec.args ?? [], {
        cwd: runtime.cwd,
        env: { ...process.env, FORCE_COLOR: '1', CI: '1', NODE_OPTIONS: '--no-deprecation' },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      })
      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString()
        outputBuffer += text
        for (const line of text.split(/\r?\n/)) {
          const cleanLine = stripAnsi(line).trim()
          if (parseTestFileLine(cleanLine)) {
            processedFiles += 1
            results.push(true)
            drawProgressBar('Coverage', target.name, Math.min(processedFiles, totalFiles), totalFiles, results, totalCoverage)
          }
          const covMatch = cleanLine.match(/All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/)
          if (covMatch) {
            totalCoverage = Number.parseFloat(covMatch[4])
            drawProgressBar('Coverage', target.name, totalFiles, totalFiles, results, totalCoverage)
          }
        }
      })
      child.stderr.on('data', (data: Buffer) => {
        outputBuffer += data.toString()
      })
      child.on('close', (exitCode) => resolve(exitCode ?? 1))
      child.on('error', () => resolve(1))
    })

    const duration = ((Date.now() - startedAt) / 1000).toFixed(1)
    drawProgressBar('Coverage', target.name, totalFiles, totalFiles, results, totalCoverage)
    if (code !== 0) {
      console.info(`\x1b[31m FALHA\x1b[0m (${duration}s)`)
      console.info(outputBuffer)
      throw new Error(`Coverage failed for ${target.name}.`)
    }
    console.info(`\x1b[32m OK\x1b[0m (${duration}s)`)
  }

  console.info('\n\x1b[32m✔ Relatórios de cobertura gerados com sucesso!\x1b[0m')
}

export function runWorkspaceTestTask(runtime: Runtime, taskName: string, extraArgs: string[]): void {
  const supportedTasks = new Set(['test', 'test:coverage'])
  if (!supportedTasks.has(taskName)) {
    throw new Error(`Unsupported workspace test task: ${taskName}`)
  }

  const packageJsonPath = path.join(process.cwd(), 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Could not find package.json in ${process.cwd()}`)
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string }
  if (!packageJson.name) {
    throw new Error(`Could not resolve package name from ${packageJsonPath}`)
  }

  const hasTurboContext = [
    process.env.TURBO_HASH,
    process.env.TURBO_TASK_ID,
    process.env.TURBO_TASK,
    process.env.TURBO_PACKAGE_NAME,
    process.env.TURBO_INVOCATION_DIR,
  ].some((value) => typeof value === 'string' && value.length > 0)
  const packageDir = process.cwd()
  const initCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : null
  const isInvokedFromOutsidePackage = initCwd !== null && !isSameOrInsidePath(initCwd, packageDir)
  const isRunningInsideTurbo = process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO === '1' || hasTurboContext || isInvokedFromOutsidePackage
  const commandSpec = isRunningInsideTurbo
    ? buildPackageManagerCommand(runtime.config.packageManager, taskName === 'test:coverage'
      ? ['exec', 'vitest', 'run', '--coverage', ...extraArgs]
      : ['exec', 'vitest', 'run', ...extraArgs])
    : buildPackageManagerCommand(runtime.config.packageManager, extraArgs.length > 0
      ? ['turbo', 'run', taskName, `--filter=${packageJson.name}`, '--', ...extraArgs]
      : ['turbo', 'run', taskName, `--filter=${packageJson.name}`])

  const result = spawnSync(commandSpec.command, commandSpec.args ?? [], {
    cwd: isRunningInsideTurbo ? packageDir : runtime.cwd,
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR || '1',
      WEBTOOLKIT_WORKSPACE_TEST_TURBO: isRunningInsideTurbo ? process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO : '1',
    },
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

function isSameOrInsidePath(childPath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const flagsWithValue = new Set([
  '--config',
  '--configLoader',
  '--filter',
  '--hookTimeout',
  '--maxWorkers',
  '--minWorkers',
  '--pool',
  '--reporter',
  '--sequence.seed',
  '--sequence.shuffle',
  '--testNamePattern',
  '--testTimeout',
  '-t',
])

function splitArgs(rawArgs: string[]): { testFiles: string[]; extraArgs: string[] } {
  const testFiles: string[] = []
  const extraArgs: string[] = []

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (arg.startsWith('-')) {
      extraArgs.push(arg)
      if (flagsWithValue.has(arg) && rawArgs[index + 1] && !rawArgs[index + 1].startsWith('-')) {
        extraArgs.push(rawArgs[index + 1])
        index += 1
      }
      continue
    }
    testFiles.push(arg)
  }

  return { testFiles, extraArgs }
}

function getFilterValue(rawArgs: string[]): string | null {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (arg === '--filter' && rawArgs[index + 1]) return rawArgs[index + 1]
    if (arg.startsWith('--filter=')) return arg.slice('--filter='.length)
  }
  return null
}

function runMultipleWorkspaceTestFiles(runtime: Runtime, testFiles: string[], extraArgs: string[]): void {
  const testConfig = getWorkspaceConfig(runtime.config)
  const byWorkspace = new Map<string, { absPkgPath: string; filePaths: string[] }>()

  for (const testFile of testFiles) {
    const absPath = path.resolve(process.cwd(), testFile)
    const target = testConfig.workspaces.find((workspace) => isSameOrInsidePath(absPath, path.resolve(runtime.cwd, workspace.path)))
    if (!target) {
      throw new Error(`O arquivo ${testFile} nao pertence a nenhum workspace conhecido.`)
    }
    const current = byWorkspace.get(target.package) ?? {
      absPkgPath: path.resolve(runtime.cwd, target.path),
      filePaths: [],
    }
    current.filePaths.push(absPath)
    byWorkspace.set(target.package, current)
  }

  const flagArgs = extraArgs.filter((arg) => arg.startsWith('-'))
  for (const [targetPackage, workspaceData] of byWorkspace.entries()) {
    console.info(`\nExecutando testes em \x1b[1m${targetPackage}\x1b[0m...\n`)
    const fileArgs = workspaceData.filePaths.map((filePath) => path.relative(workspaceData.absPkgPath, filePath).split(path.sep).join('/'))
    const commandSpec = buildPackageManagerCommand(runtime.config.packageManager, ['--filter', targetPackage, 'run', 'test', ...fileArgs, ...flagArgs])
    const result = spawnSync(commandSpec.command, commandSpec.args ?? [], {
      cwd: runtime.cwd,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    })
    if (result.error) throw result.error
    if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
  }
}
