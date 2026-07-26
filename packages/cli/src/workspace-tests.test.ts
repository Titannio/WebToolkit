import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildErrorLog,
  clampFailureExcerptLines,
  countTestFiles,
  drawProgressBar,
  extractFailureExcerpt,
  findFailedTestsSectionStartIndex,
  formatCoverageSummary,
  formatFailureSummary,
  formatWorkspaceTestStatusLine,
  getFilterValue,
  getWorkspaceConfig,
  isFailureLogNoiseLine,
  isFailureStartLine,
  isFailureSummaryLine,
  isSameOrInsidePath,
  normalizeReportLine,
  parseCoverageSummary,
  parseFailureSummary,
  parseTestFileLine,
  progressBlockHasFailure,
  resolveTargets,
  runWorkspaceCoverage,
  runWorkspaceTestTask,
  runWorkspaceTests,
  splitArgs,
  stripAnsi,
} from './workspace-tests.js'
import { mergeConfig } from './config.js'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...(actual as object),
    existsSync: vi.fn(actual.existsSync),
  }
})

vi.mock('node:child_process')
vi.mock('./process.js', () => ({
  buildPackageManagerCommand: vi.fn(),
}))

import { spawnSync as spawnSyncOriginal, spawn as spawnOriginal } from 'node:child_process'
import { buildPackageManagerCommand } from './process.js'

const spawnSyncMock = vi.mocked(spawnSyncOriginal)
const spawnMock = vi.mocked(spawnOriginal)
const commandMock = vi.mocked(buildPackageManagerCommand)
const runtimeWithConfig = (cwd: string, config: Parameters<typeof mergeConfig>[0]) => ({ cwd, config: mergeConfig(config) })

function mockChildProcess(run: (child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }) => void): void {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  spawnMock.mockReturnValueOnce(child as never)
  setTimeout(() => run(child), 0)
}

afterEach(() => {
  vi.restoreAllMocks()
  spawnSyncMock.mockReset()
  spawnMock.mockReset()
  commandMock.mockReset()
})

describe('workspace test status formatting', () => {
  it('formats successful workspace test output', () => {
    expect(formatWorkspaceTestStatusLine({ failed: false, duration: '179.3' })).toContain('\x1b[32mOK\x1b[0m (179.3s)')
  })

  it('formats failed workspace test output with summary', () => {
    expect(formatWorkspaceTestStatusLine({
      failed: true,
      duration: '123.4',
      summary: { failedFiles: 7, failedTests: 9, failedTestsDetected: true },
    })).toContain('\x1b[31mERROR\x1b[0m - 9 failures across 7 files (123.4s)')
  })

  it('formats failure summaries', () => {
    expect(formatFailureSummary({ failedFiles: 1, failedTests: 1, failedTestsDetected: true })).toBe('1 failure across 1 file')
    expect(formatFailureSummary({ failedFiles: 2, failedTests: 1, failedTestsDetected: false })).toBe('failures not detected across 2 files')
    expect(formatFailureSummary({ failedFiles: 3, failedTests: 4, failedTestsDetected: true })).toBe('4 failures across 3 files')
  })

  it('marks a progress block as failed when any represented test result failed', () => {
    const results = Array.from({ length: 100 }, () => true)
    results[2] = false

    expect(progressBlockHasFailure(1, 60, 100, results)).toBe(true)
    expect(progressBlockHasFailure(2, 60, 100, results)).toBe(false)
    expect(progressBlockHasFailure(0, 60, 0, [])).toBe(false)
  })
})

describe('workspace test parsing helpers', () => {
  it('validates config, scans test files, and resolves workspace filters', async () => {
    expect(() => getWorkspaceConfig(mergeConfig())).toThrow('not configured')
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-scan-'))
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true })
    await mkdir(path.join(root, 'node_modules'), { recursive: true })
    await writeFile(path.join(root, 'src', 'one.test.ts'), '')
    await writeFile(path.join(root, 'src', 'nested', 'two.spec.tsx'), '')
    await writeFile(path.join(root, 'src', 'nested', 'ignore.ts'), '')
    await writeFile(path.join(root, 'node_modules', 'three.test.ts'), '')
    expect(countTestFiles(path.join(root, 'missing'), /\.test\.ts$/u, new Set())).toBe(0)
    expect(countTestFiles(root, /\.(test|spec)\.(ts|tsx)$/u, new Set(['node_modules']))).toBe(2)

    const runtime = runtimeWithConfig(root, {
      workspaceTests: {
        workspaces: [
          { name: 'App', package: '@scope/app', path: 'src' },
          { name: 'Other', package: '@scope/other', path: 'other' },
        ],
      },
    })
    expect(resolveTargets(runtime, ['--filter', '@scope/app'])).toHaveLength(1)
    expect(resolveTargets(runtime, ['--filter=other'])).toEqual([expect.objectContaining({ name: 'Other' })])
    const previousInitCwd = process.env.INIT_CWD
    process.env.INIT_CWD = path.join(root, 'src')
    expect(resolveTargets(runtime, [])).toEqual([expect.objectContaining({ name: 'App' })])
    process.env.INIT_CWD = path.join(root, 'unknown')
    expect(resolveTargets(runtime, [])).toHaveLength(2)
    delete process.env.INIT_CWD
    expect(resolveTargets(runtime, [])).toHaveLength(2)
    if (previousInitCwd === undefined) delete process.env.INIT_CWD
    else process.env.INIT_CWD = previousInitCwd
    await rm(root, { recursive: true, force: true })
  })

  it('normalizes runner lines and identifies failure markers and noise', () => {
    expect(stripAnsi('\x1b[31mFAIL\x1b[0m')).toBe('FAIL')
    expect(normalizeReportLine('@scope/app:test: FAIL src/a.test.ts   ')).toBe('FAIL src/a.test.ts')
    expect(findFailedTestsSectionStartIndex(['ok', '--- Failed Tests 2 ---'])).toBe(1)
    expect(findFailedTestsSectionStartIndex(['⎯ Failed Tests 1 ⎯'])).toBe(0)
    expect(isFailureStartLine('Failed Tests 2')).toBe(true)
    expect(isFailureStartLine(' FAIL src/a.test.ts')).toBe(true)
    expect(isFailureStartLine(' × rejects')).toBe(true)
    expect(isFailureStartLine('ok')).toBe(false)
    for (const line of [
      'Test Files 1 failed',
      'Tests 2 failed',
      'Start at 10:00',
      'Duration 1s',
      '[ELIFECYCLE] failed',
      'ERROR run failed',
    ]) expect(isFailureSummaryLine(line)).toBe(true)
    expect(isFailureSummaryLine('ordinary output')).toBe(false)
    expect(isFailureLogNoiseLine('')).toBe(false)
    for (const line of [
      '✓ passed',
      '✔ passed',
      '◇ injected env',
      'Packages in scope: app',
      'Running test in app',
      'Remote caching disabled',
      'cache hit',
      'replaying logs',
      'executing test',
      '$ vitest',
      'Could not parse CSS stylesheet',
      'update was not wrapped in act(...)',
    ]) expect(isFailureLogNoiseLine(line)).toBe(true)
    expect(isFailureLogNoiseLine('real failure')).toBe(false)
  })

  it('extracts bounded failure excerpts and parses failure counts', () => {
    expect(clampFailureExcerptLines(['a', 'b'], 3)).toEqual(['a', 'b'])
    expect(clampFailureExcerptLines(['a', 'b', 'c', 'd', 'e'], 3)).toEqual([
      'a',
      '... omitted 3 noisy/verbose failure lines ...',
      'e',
    ])
    const section = extractFailureExcerpt([
      '✓ noise',
      '--- Failed Tests 1 ---',
      'FAIL src/a.test.ts',
      'reason',
    ].join('\n'), 10)
    expect(section).toEqual(['--- Failed Tests 1 ---', 'FAIL src/a.test.ts', 'reason'])
    const summaryTail = extractFailureExcerpt([
      'FAIL src/a.test.ts',
      'reason',
      'Test Files 1 failed',
      'Tests 2 failed',
      'Start at now',
      'Duration 1s',
      'tail 1',
      'tail 2',
      'tail 3',
      'tail 4',
      'tail 5',
      'ignored after tail',
    ].join('\n'), 30)
    expect(summaryTail).toContain('Tests 2 failed')
    expect(extractFailureExcerpt('ordinary\nlast line', 10)).toEqual(['ordinary', 'last line'])

    expect(parseFailureSummary('Test Files 2 failed | 1 passed\nTests 3 failed | 4 passed', 1, false)).toEqual({
      failedFiles: 2,
      failedTests: 3,
      failedFilesDetected: true,
      failedTestsDetected: true,
    })
    expect(parseFailureSummary('no summary', 1, false)).toMatchObject({
      failedFiles: 1,
      failedTestsDetected: false,
    })
    expect(parseFailureSummary('no summary', 0, true)).toMatchObject({ failedFiles: 1 })
    expect(parseFailureSummary('no summary', 0, false)).toMatchObject({ failedFiles: 0 })
    expect(parseFailureSummary('Test Files 2 passed\nTests 4 passed', 0, false)).toMatchObject({
      failedFilesDetected: false,
      failedTestsDetected: false,
    })
  })

  it('parses test file statuses, args, filters, and path containment', () => {
    expect(parseTestFileLine('✓ src/a.test.ts')).toEqual({ filePath: 'src/a.test.ts', isSuccess: true })
    expect(parseTestFileLine('PASS src/a.spec.tsx')).toEqual({ filePath: 'src/a.spec.tsx', isSuccess: true })
    expect(parseTestFileLine('× src/b.test.js')).toEqual({ filePath: 'src/b.test.js', isSuccess: false })
    expect(parseTestFileLine('ordinary')).toBeNull()
    expect(splitArgs(['a.test.ts', '--reporter', 'verbose', '--run', '--filter=app'])).toEqual({
      testFiles: ['a.test.ts'],
      extraArgs: ['--reporter', 'verbose', '--run', '--filter=app'],
    })
    expect(splitArgs(['--reporter', '--run'])).toEqual({ testFiles: [], extraArgs: ['--reporter', '--run'] })
    expect(getFilterValue(['--filter', 'app'])).toBe('app')
    expect(getFilterValue(['--filter=other'])).toBe('other')
    expect(getFilterValue([])).toBeNull()
    expect(isSameOrInsidePath('C:/repo/app', 'C:/repo')).toBe(true)
    expect(isSameOrInsidePath('C:/repo', 'C:/repo')).toBe(true)
    expect(isSameOrInsidePath('C:/other', 'C:/repo')).toBe(false)
  })

  it('parses and formats all coverage metrics', () => {
    const coverage = parseCoverageSummary('All files | 49 | 50 | 79.95 | 80')

    expect(coverage).toEqual({
      statements: 49,
      branches: 50,
      functions: 79.95,
      lines: 80,
    })
    expect(stripAnsi(formatCoverageSummary(coverage!))).toBe('S 49.0% B 50.0% F 80.0% L 80.0%')
    expect(parseCoverageSummary('ordinary output')).toBeNull()
  })

  it('draws progress and builds failure logs', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    drawProgressBar('Testing', 'app', -1, 0, [])
    drawProgressBar('Testing', 'app', 2, 2, [false, true])
    drawProgressBar('Coverage', 'app', 1, 1, [true], { statements: 49, branches: 49, functions: 49, lines: 49 })
    drawProgressBar('Coverage', 'app', 1, 1, [true], { statements: 50, branches: 50, functions: 50, lines: 50 })
    drawProgressBar('Coverage', 'app', 1, 1, [true], { statements: 80, branches: 80, functions: 80, lines: 80 })
    expect(write).toHaveBeenCalledTimes(5)

    const runtime = runtimeWithConfig('/repo', {
      workspaceTests: {
        workspaces: [{ name: 'app', package: 'app', path: 'app' }],
        maxFailureExcerptLines: 2,
      },
    })
    const result = {
      target: { name: 'app', package: 'app', path: 'app' },
      command: 'pnpm test',
      duration: '1.0',
      exitCode: 1,
      outputBuffer: 'FAIL app.test.ts\nreason',
      failed: true,
      failedFiles: 1,
      failedTests: 0,
      failedFilesDetected: false,
      failedTestsDetected: false,
    }
    expect(buildErrorLog([], runtime)).toBe('')
    const log = buildErrorLog([result], runtime)
    expect(log).toContain('Failed files: 1 (fallback)')
    expect(log).toContain('Failed tests: not detected')
    const detectedLog = buildErrorLog([{
      ...result,
      failedFilesDetected: true,
      failedTestsDetected: true,
      failedTests: 2,
    }], runtimeWithConfig('/repo', {
      workspaceTests: {
        workspaces: [{ name: 'app', package: 'app', path: 'app' }],
      },
    }))
    expect(detectedLog).toContain('Failed files: 1')
    expect(detectedLog).toContain('Failed tests: 2')
  })
})

describe('workspace test task selection', () => {
  it('rejects unsupported workspace task names', () => {
    expect(() => runWorkspaceTestTask(runtimeWithConfig('/repo', { packageManager: 'pnpm', workspaceTests: { workspaces: [] } }), 'build', []))
      .toThrow('Unsupported workspace test task: build')
  })

  it('validates the package manifest and child-process result', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-task-errors-'))
    const previousCwd = process.cwd()
    const previousForceColor = process.env.FORCE_COLOR
    const previousTurbo = process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO
    const previousInitCwd = process.env.INIT_CWD
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    try {
      process.chdir(root)
      expect(() => runWorkspaceTestTask(runtimeWithConfig(root, {
        workspaceTests: { workspaces: [] },
      }), 'test', [])).toThrow('Could not find package.json')

      await writeFile(path.join(root, 'package.json'), '{}')
      expect(() => runWorkspaceTestTask(runtimeWithConfig(root, {
        workspaceTests: { workspaces: [] },
      }), 'test', [])).toThrow('Could not resolve package name')

      await writeFile(path.join(root, 'package.json'), '{"name":"app"}')
      delete process.env.INIT_CWD
      process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO = '1'
      process.env.FORCE_COLOR = '3'
      commandMock.mockReturnValue({ command: 'pnpm', args: ['exec', 'vitest', 'run'] })
      spawnSyncMock.mockReturnValueOnce({ error: new Error('spawn failed') } as never)
      expect(() => runWorkspaceTestTask(runtimeWithConfig(root, {
        workspaceTests: { workspaces: [] },
      }), 'test', [])).toThrow('spawn failed')

      spawnSyncMock.mockReturnValueOnce({ status: null } as never)
      runWorkspaceTestTask(runtimeWithConfig(root, {
        workspaceTests: { workspaces: [] },
      }), 'test', [])
      expect(exit).toHaveBeenCalledWith(1)
      expect(spawnSyncMock).toHaveBeenLastCalledWith(
        'pnpm',
        expect.any(Array),
        expect.objectContaining({ env: expect.objectContaining({ FORCE_COLOR: '3' }) }),
      )
    } finally {
      process.chdir(previousCwd)
      if (previousForceColor === undefined) delete process.env.FORCE_COLOR
      else process.env.FORCE_COLOR = previousForceColor
      if (previousTurbo === undefined) delete process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO
      else process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO = previousTurbo
      if (previousInitCwd === undefined) delete process.env.INIT_CWD
      else process.env.INIT_CWD = previousInitCwd
      await rm(root, { recursive: true, force: true })
    }
  })

  it('passes explicit args through the outer turbo command', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-task-args-'))
    const previousCwd = process.cwd()
    const previousInitCwd = process.env.INIT_CWD
    const previousTurbo = process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO
    try {
      await writeFile(path.join(root, 'package.json'), '{"name":"app"}')
      process.chdir(root)
      process.env.INIT_CWD = root
      delete process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO
      commandMock.mockReturnValue({ command: 'pnpm', args: ['turbo'] })
      spawnSyncMock.mockReturnValue({ status: 0 } as never)
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      runWorkspaceTestTask(runtimeWithConfig(root, {
        workspaceTests: { workspaces: [] },
      }), 'test', ['--reporter=verbose'])

      expect(commandMock).toHaveBeenCalledWith('pnpm', [
        'turbo',
        'run',
        'test',
        '--filter=app',
        '--',
        '--reporter=verbose',
      ])
    } finally {
      process.chdir(previousCwd)
      if (previousInitCwd === undefined) delete process.env.INIT_CWD
      else process.env.INIT_CWD = previousInitCwd
      if (previousTurbo === undefined) delete process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO
      else process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO = previousTurbo
      await rm(root, { recursive: true, force: true })
    }
  })

  it('runs Vitest directly in package-local mode', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-task-local-'))
    const previousCwd = process.cwd()
    try {
      await writeFile(path.join(root, 'package.json'), '{"name":"app"}')
      process.chdir(root)
      commandMock.mockReturnValue({ command: 'pnpm', args: ['exec', 'vitest', 'run'] })
      spawnSyncMock.mockReturnValue({ status: 0 } as never)
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      runWorkspaceTestTask(runtimeWithConfig(root, {
        packageManager: 'pnpm',
        workspaceTests: { executionMode: 'package-local', workspaces: [] },
      }), 'test', [])

      expect(commandMock).toHaveBeenCalledWith('pnpm', ['exec', 'vitest', 'run'])
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'pnpm',
        ['exec', 'vitest', 'run'],
        expect.objectContaining({ cwd: root }),
      )
    } finally {
      process.chdir(previousCwd)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('runs in turbo mode when turbo context variables are present', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-tests-'))
    const cwdBackup = process.cwd()
    const previousTurboTask = process.env.TURBO_TASK
    process.env.TURBO_TASK = 'test'
    delete process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO
    process.chdir(temp)
    await writeFile(path.join(temp, 'package.json'), JSON.stringify({ name: 'repo-root' }), 'utf8')

    spawnSyncMock.mockReturnValue({ status: 0 } as never)
    commandMock.mockReturnValue({ command: 'pnpm', args: ['exec', 'vitest', 'run', '--coverage', '--maxWorkers', '4'] })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    try {
      runWorkspaceTestTask(
        runtimeWithConfig('C:/repo-root', { packageManager: 'pnpm', workspaceTests: { workspaces: [] } }),
        'test:coverage',
        ['--maxWorkers', '4'],
      )
      expect(commandMock).toHaveBeenCalledWith('pnpm', ['exec', 'vitest', 'run', '--coverage', '--maxWorkers', '4'])
      expect(spawnSyncMock).toHaveBeenCalledWith('pnpm', ['exec', 'vitest', 'run', '--coverage', '--maxWorkers', '4'], expect.objectContaining({
        cwd: process.cwd(),
      }))
      expect(exitSpy).toHaveBeenCalledWith(0)
    } finally {
      process.chdir(cwdBackup)
      if (typeof previousTurboTask === 'undefined') {
        delete process.env.TURBO_TASK
      } else {
        process.env.TURBO_TASK = previousTurboTask
      }
      delete process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO
      fs.rmSync(temp, { recursive: true, force: true })
      vi.spyOn(process, 'exit').mockRestore()
    }
  })

  it('runs with turbo fallback when no turbo context is detected', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-tests-task-'))
    const cwdBackup = process.cwd()
    const previousTurboTask = process.env.TURBO_TASK
    const previousTurboEnv = process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO
    const previousTurboHash = process.env.TURBO_HASH
    const previousTurboTaskId = process.env.TURBO_TASK_ID
    const previousTurboPackageName = process.env.TURBO_PACKAGE_NAME
    const previousTurboInvocationDir = process.env.TURBO_INVOCATION_DIR
    const previousInitCwd = process.env.INIT_CWD
    delete process.env.TURBO_TASK
    delete process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO
    delete process.env.TURBO_HASH
    delete process.env.TURBO_TASK_ID
    delete process.env.TURBO_PACKAGE_NAME
    delete process.env.TURBO_INVOCATION_DIR
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'test-package' }), 'utf8')
    fs.mkdirSync(root, { recursive: true })
    process.chdir(root)
    process.env.INIT_CWD = root
    spawnSyncMock.mockReturnValue({ status: 0 } as never)
    commandMock.mockReturnValue({ command: 'pnpm', args: ['turbo', 'run', 'test', '--filter=test-package'] })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    const packageRoot = path.join(root, 'packages', 'app')
    await mkdir(packageRoot, { recursive: true })

    runWorkspaceTestTask(
      runtimeWithConfig('C:/repo-root', { packageManager: 'pnpm', workspaceTests: { workspaces: [] } }),
      'test',
      [],
    )

    expect(commandMock).toHaveBeenCalledWith('pnpm', ['turbo', 'run', 'test', '--filter=test-package'])
    expect(spawnSyncMock).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(0)

    if (typeof previousTurboTask === 'undefined') {
      delete process.env.TURBO_TASK
    } else {
      process.env.TURBO_TASK = previousTurboTask
    }
    if (typeof previousTurboEnv === 'undefined') {
      delete process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO
    } else {
      process.env.WEBTOOLKIT_WORKSPACE_TEST_TURBO = previousTurboEnv
    }
    if (typeof previousTurboHash === 'undefined') {
      delete process.env.TURBO_HASH
    } else {
      process.env.TURBO_HASH = previousTurboHash
    }
    if (typeof previousTurboTaskId === 'undefined') {
      delete process.env.TURBO_TASK_ID
    } else {
      process.env.TURBO_TASK_ID = previousTurboTaskId
    }
    if (typeof previousTurboPackageName === 'undefined') {
      delete process.env.TURBO_PACKAGE_NAME
    } else {
      process.env.TURBO_PACKAGE_NAME = previousTurboPackageName
    }
    if (typeof previousTurboInvocationDir === 'undefined') {
      delete process.env.TURBO_INVOCATION_DIR
    } else {
      process.env.TURBO_INVOCATION_DIR = previousTurboInvocationDir
    }
    if (typeof previousInitCwd === 'undefined') {
      delete process.env.INIT_CWD
    } else {
      process.env.INIT_CWD = previousInitCwd
    }
    process.chdir(cwdBackup)
    fs.rmSync(root, { recursive: true, force: true })
    vi.restoreAllMocks()
  })
})

describe('workspace multi-file execution', () => {
  it('runs multiple explicit test files by workspace package', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-multi-'))
    const appPath = path.join(temp, 'packages', 'app')
    await mkdir(appPath, { recursive: true })
    const file1 = path.join(appPath, 'a.test.ts')
    const file2 = path.join(appPath, 'b.test.ts')
    await Promise.all([writeFile(file1, 'const x = 1;'), writeFile(file2, 'const y = 2;')])
    const packageJson = path.join(temp, 'package.json')
    await writeFile(packageJson, JSON.stringify({ name: '@scope/app' }))

    const runtime = runtimeWithConfig(temp, {
      packageManager: 'pnpm',
      workspaceTests: {
        workspaces: [{ name: 'app', package: '@scope/app', path: 'packages/app' }],
      },
    })

    const configMock = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(temp)
    spawnMock.mockImplementation(() => ({
      on: vi.fn(),
    }) as never)
    spawnSyncMock.mockReturnValue({ status: 0 } as never)
    commandMock.mockImplementation((_packageManager) => ({ command: 'pnpm', args: ['--filter', '@scope/app', 'run', 'test', 'a.test.ts', 'b.test.ts'] }))

    await runWorkspaceTests(runtime, ['packages/app/a.test.ts', 'packages/app/b.test.ts'])

    expect(configMock).toHaveBeenCalledWith(expect.stringContaining('Running tests in'))
    expect(spawnSyncMock).toHaveBeenCalledWith('pnpm', expect.arrayContaining(['--filter', '@scope/app', 'run', 'test']), expect.anything())
    expect(commandMock).toHaveBeenCalledWith('pnpm', ['--filter', '@scope/app', 'run', 'test', 'a.test.ts', 'b.test.ts'])

    cwdSpy.mockRestore()
    await rm(temp, { recursive: true, force: true })
  })

  it('rejects files outside configured workspaces', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-outside-'))
    const outside = path.join(root, 'outside.test.ts')
    await writeFile(outside, '')
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    await expect(runWorkspaceTests(runtimeWithConfig(root, {
      workspaceTests: {
        workspaces: [{ name: 'app', package: 'app', path: 'app' }],
      },
    }), ['outside.test.ts'])).rejects.toThrow('does not belong')
    await rm(root, { recursive: true, force: true })
  })

  it('surfaces multi-file spawn errors and nonzero exits', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-multi-errors-'))
    await mkdir(path.join(root, 'app'))
    await writeFile(path.join(root, 'app', 'one.test.ts'), '')
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    commandMock.mockReturnValue({ command: 'pnpm', args: ['test'] })
    const runtime = runtimeWithConfig(root, {
      workspaceTests: {
        workspaces: [{ name: 'app', package: 'app', path: 'app' }],
      },
    })
    spawnSyncMock.mockReturnValueOnce({ error: new Error('spawn failed') } as never)
    await expect(runWorkspaceTests(runtime, ['app/one.test.ts'])).rejects.toThrow('spawn failed')

    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    spawnSyncMock.mockReturnValueOnce({ status: 2 } as never)
    await runWorkspaceTests(runtime, ['app/one.test.ts', '--reporter', 'verbose'])
    expect(exit).toHaveBeenCalledWith(2)

    spawnSyncMock.mockReturnValueOnce({ status: null } as never)
    await runWorkspaceTests(runtime, ['app/one.test.ts'])
    expect(exit).toHaveBeenCalledWith(1)
    await rm(root, { recursive: true, force: true })
  })
})

describe('workspace full test execution', () => {
  it('skips workspaces without tests and completes successfully', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-skip-'))
    await mkdir(path.join(root, 'app'))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const runtime = runtimeWithConfig(root, {
      workspaceTests: {
        workspaces: [{ name: 'app', package: 'app', path: 'app' }],
      },
    })

    await expect(runWorkspaceTests(runtime, [])).resolves.toBeUndefined()
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('SKIPPED'))
    await rm(root, { recursive: true, force: true })
  })

  it('streams successful test output and ignores duplicate file reports', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-pass-'))
    await mkdir(path.join(root, 'app'))
    await writeFile(path.join(root, 'app', 'one.test.ts'), '')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    commandMock.mockReturnValue({ command: 'pnpm', args: ['test'] })
    mockChildProcess((child) => {
      child.stdout.emit('data', Buffer.from('PASS src/one.test.ts\nPASS src/one.test.ts\n'))
      child.stderr.emit('data', Buffer.from('warning\n'))
      child.emit('close', 0)
    })

    await expect(runWorkspaceTests(runtimeWithConfig(root, {
      packageManager: 'pnpm',
      workspaceTests: {
        executionMode: 'package-local',
        workspaces: [{ name: 'app', package: 'app', path: 'app' }],
      },
    }), [])).resolves.toBeUndefined()

    expect(commandMock).toHaveBeenCalledWith('pnpm', ['run', 'test', '--', '--reporter=verbose'])
    expect(spawnMock).toHaveBeenCalledWith(
      'pnpm',
      ['test'],
      expect.objectContaining({ cwd: path.join(root, 'app') }),
    )
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('\x1b[32mOK'))
    await rm(root, { recursive: true, force: true })
  })

  it('writes a consolidated log for failures and settles only once', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-fail-'))
    await mkdir(path.join(root, 'app'))
    await writeFile(path.join(root, 'app', 'one.test.ts'), '')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    commandMock.mockReturnValue({ command: 'pnpm', args: ['test'] })
    mockChildProcess((child) => {
      child.stdout.emit('data', Buffer.from('× src/one.test.ts\nTest Files 1 failed\nTests 2 failed\n'))
      child.emit('error', new Error('runner failed'))
      child.emit('close', null)
    })

    await expect(runWorkspaceTests(runtimeWithConfig(root, {
      workspaceTests: {
        workspaces: [{ name: 'app', package: 'app', path: 'app' }],
        errorLogFile: 'errors.log',
      },
    }), [])).rejects.toThrow('Workspace tests failed')

    expect(fs.readFileSync(path.join(root, 'errors.log'), 'utf8')).toContain('[runner-error]')
    await rm(root, { recursive: true, force: true })
  })

  it('handles null closes and runner errors without stack traces', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-null-close-'))
    await writeFile(path.join(root, 'one.test.ts'), '')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    commandMock.mockReturnValue({ command: 'pnpm', args: ['test'] })
    const runtime = runtimeWithConfig(root, {
      workspaceTests: {
        workspaces: [{ name: 'app', package: 'app', path: '.' }],
      },
    })

    mockChildProcess((child) => {
      child.stdout.emit('data', Buffer.from('PASS one.test.ts\n'))
      child.emit('close', null)
    })
    await expect(runWorkspaceTests(runtime, [])).rejects.toThrow('Workspace tests failed')

    mockChildProcess((child) => {
      child.emit('error', { message: 'plain failure', stack: '' })
    })
    await expect(runWorkspaceTests(runtime, [])).rejects.toThrow('Workspace tests failed')
    await rm(root, { recursive: true, force: true })
  })
})

describe('workspace coverage command', () => {
  it('skips empty workspaces and reports successful coverage output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-coverage-pass-'))
    await mkdir(path.join(root, 'empty'))
    await mkdir(path.join(root, 'app'))
    await writeFile(path.join(root, 'app', 'one.test.ts'), '')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    commandMock.mockReturnValue({ command: 'pnpm', args: ['coverage'] })
    mockChildProcess((child) => {
      child.stdout.emit('data', Buffer.from('✓ src/one.test.ts\nAll files | 60 | 60 | 60 | 60\n'))
      child.stderr.emit('data', Buffer.from('warning\n'))
      child.emit('close', 0)
    })

    await expect(runWorkspaceCoverage(runtimeWithConfig(root, {
      packageManager: 'pnpm',
      workspaceTests: {
        executionMode: 'package-local',
        workspaces: [
          { name: 'empty', package: 'empty', path: 'empty' },
          { name: 'app', package: 'app', path: 'app' },
        ],
      },
    }), [])).resolves.toBeUndefined()

    expect(commandMock).toHaveBeenCalledWith('pnpm', ['run', 'test:coverage'])
    expect(spawnMock).toHaveBeenCalledWith(
      'pnpm',
      ['coverage'],
      expect.objectContaining({ cwd: path.join(root, 'app') }),
    )
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Coverage reports'))
    await rm(root, { recursive: true, force: true })
  })

  it('treats coverage process errors and null close codes as failures', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-coverage-error-'))
    await writeFile(path.join(root, 'one.test.ts'), '')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    commandMock.mockReturnValue({ command: 'pnpm', args: ['coverage'] })
    mockChildProcess((child) => child.emit('error', new Error('spawn failed')))

    const runtime = runtimeWithConfig(root, {
      workspaceTests: {
        workspaces: [{ name: 'app', package: 'app', path: '.' }],
      },
    })
    await expect(runWorkspaceCoverage(runtime, [])).rejects.toThrow('Coverage failed')

    mockChildProcess((child) => child.emit('close', null))
    await expect(runWorkspaceCoverage(runtime, [])).rejects.toThrow('Coverage failed')
    await rm(root, { recursive: true, force: true })
  })

  it('passes through errors from failed workspace coverage', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-coverage-'))
    const root = temp
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@scope/app' }))

    const runtime = runtimeWithConfig(root, {
      packageManager: 'pnpm',
      workspaceTests: {
        workspaces: [{ name: 'app', package: '@scope/app', path: '.' }],
        testFilePattern: '\\.(test|spec)\\.(ts|tsx)$',
      },
    })

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(root)
    const runSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await writeFile(path.join(root, 'failed.test.ts'), 'test()')

    try {
      const fakeStdout = new EventEmitter()
      const fakeStderr = new EventEmitter()
      const fake = Object.assign(new EventEmitter(), { stdout: fakeStdout, stderr: fakeStderr }) as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      spawnMock.mockImplementation(() => fake as never)
      setTimeout(() => {
        fakeStdout.emit('data', 'All files | 123 | 80.0 | 90.0 | 80.0')
        fake.emit('close', 1)
      }, 0)
      commandMock.mockReturnValue({ command: 'pnpm', args: ['turbo', 'run', 'test:coverage', '--filter', '@scope/app'] })

      await expect(runWorkspaceCoverage(runtime, ['--something'])).rejects.toThrow('Coverage failed for app.')
      expect(commandMock).toHaveBeenCalled()
      expect(runSpy).toHaveBeenCalledWith(expect.stringContaining('\x1b[31m FAIL'))
    } finally {
      cwdSpy.mockRestore()
      runSpy.mockRestore()
      await rm(temp, { recursive: true, force: true })
    }
  })
})
