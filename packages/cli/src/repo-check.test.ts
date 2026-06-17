import { afterEach, describe, expect, it, vi } from 'vitest'

import { runRepoCheck } from './repo-check.js'
import { mergeConfig } from './config.js'

vi.mock('./process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./process.js')>()
  return {
    ...actual,
    runCommandInherited: vi.fn(),
  }
})

vi.mock('./guard-runner.js', () => ({
  executeBuiltinGuard: vi.fn(),
}))

import { runCommandInherited } from './process.js'
import { executeBuiltinGuard } from './guard-runner.js'

const runtimeWithConfig = (cwd: string, config: Parameters<typeof mergeConfig>[0]) => ({ cwd, config: mergeConfig(config) })

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(runCommandInherited).mockReset()
  vi.mocked(executeBuiltinGuard).mockReset()
})

describe('repo check engine', () => {
  it('runs command-based steps and completes without failure', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.mocked(runCommandInherited).mockReturnValue(0)

    runRepoCheck(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      repoCheck: {
        steps: [
          {
            label: 'TypeScript',
            command: 'pnpm',
            args: ['exec', 'tsc'],
          },
        ],
      },
    }))

    expect(runCommandInherited).toHaveBeenCalledWith({ command: 'pnpm', args: ['exec', 'tsc'] }, '/repo')
    expect(info).toHaveBeenCalled()
  })

  it('requires repoCheck.steps to be configured', () => {
    expect(() => runRepoCheck(runtimeWithConfig('/repo', { packageManager: 'pnpm' })))
      .toThrow('repoCheck.steps is not configured.')
  })

  it('runs builtin guard checks with arguments and handles failures', () => {
    vi.mocked(executeBuiltinGuard).mockReturnValue(3)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    runRepoCheck(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      repoCheck: {
        steps: [
          {
            label: 'Guard',
            builtinGuard: 'any',
            args: ['--help'],
          },
        ],
      },
    }))

    expect(vi.mocked(executeBuiltinGuard)).toHaveBeenCalledWith('any', ['--help'], '/repo')
    expect(processExit).toHaveBeenCalledWith(1)
    processExit.mockRestore()
  })

  it('handles invalid steps by entering failure path', () => {
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    runRepoCheck(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      repoCheck: {
        steps: [{ label: 'Invalid' }],
      },
    }))

    expect(processExit).toHaveBeenCalledWith(1)
    processExit.mockRestore()
  })

  it('skips subsequent fail-fast steps after a failing command', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.mocked(runCommandInherited)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(0)

    runRepoCheck(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      repoCheck: {
        steps: [
          { label: 'A', command: 'pnpm', args: ['a'] },
          { label: 'B', command: 'pnpm', args: ['b'] },
        ],
      },
    }))

    expect(runCommandInherited).toHaveBeenCalledTimes(1)
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('SKIP'))
    expect(processExit).toHaveBeenCalledWith(1)
    processExit.mockRestore()
  })

  it('runs all steps when failFast is disabled', () => {
    vi.mocked(runCommandInherited).mockReturnValueOnce(1).mockReturnValueOnce(1)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    runRepoCheck(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      repoCheck: {
        failFast: false,
        steps: [
          { label: 'A', command: 'pnpm', args: ['a'] },
          { label: 'B', command: 'pnpm', args: ['b'] },
        ],
      },
    }))

    expect(vi.mocked(runCommandInherited)).toHaveBeenCalledTimes(2)
    expect(processExit).toHaveBeenCalledWith(1)
    processExit.mockRestore()
  })
})
