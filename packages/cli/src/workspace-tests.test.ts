import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatFailureSummary, formatWorkspaceTestStatusLine, progressBlockHasFailure, runWorkspaceTestTask, runWorkspaceTests, runWorkspaceCoverage } from './workspace-tests.js'
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
    })).toContain('\x1b[31mERRO\x1b[0m - 9 falhas em 7 arquivos (123.4s)')
  })

  it('formats failure summaries', () => {
    expect(formatFailureSummary({ failedFiles: 1, failedTests: 1, failedTestsDetected: true })).toBe('1 falha em 1 arquivo')
    expect(formatFailureSummary({ failedFiles: 2, failedTests: 1, failedTestsDetected: false })).toBe('falhas nao detectadas em 2 arquivos')
    expect(formatFailureSummary({ failedFiles: 3, failedTests: 4, failedTestsDetected: true })).toBe('4 falhas em 3 arquivos')
  })

  it('marks a progress block as failed when any represented test result failed', () => {
    const results = Array.from({ length: 100 }, () => true)
    results[2] = false

    expect(progressBlockHasFailure(1, 60, 100, results)).toBe(true)
    expect(progressBlockHasFailure(2, 60, 100, results)).toBe(false)
    expect(progressBlockHasFailure(0, 60, 0, [])).toBe(false)
  })
})

describe('workspace test task selection', () => {
  it('rejects unsupported workspace task names', () => {
    expect(() => runWorkspaceTestTask(runtimeWithConfig('/repo', { packageManager: 'pnpm', workspaceTests: { workspaces: [] } }), 'build', []))
      .toThrow('Unsupported workspace test task: build')
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

    expect(configMock).toHaveBeenCalledWith(expect.stringContaining('Executando testes em'))
    expect(spawnSyncMock).toHaveBeenCalledWith('pnpm', expect.arrayContaining(['--filter', '@scope/app', 'run', 'test']), expect.anything())
    expect(commandMock).toHaveBeenCalledWith('pnpm', ['--filter', '@scope/app', 'run', 'test', 'a.test.ts', 'b.test.ts'])

    cwdSpy.mockRestore()
    await rm(temp, { recursive: true, force: true })
  })
})

describe('workspace coverage command', () => {
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
      expect(runSpy).toHaveBeenCalledWith(expect.stringContaining('\x1b[31m FALHA'))
    } finally {
      cwdSpy.mockRestore()
      runSpy.mockRestore()
      await rm(temp, { recursive: true, force: true })
    }
  })
})
