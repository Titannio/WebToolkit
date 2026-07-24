import { afterEach, describe, expect, it, vi } from 'vitest'

import { runReleaseGate } from './release-gate.js'
import { mergeConfig } from './config.js'

const processSpy = vi.spyOn(process, 'exit')

vi.mock('./process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./process.js')>()
  return {
    ...actual,
    runCommandInherited: vi.fn(),
  }
})

import { runCommandInherited } from './process.js'

const runCommandInheritedMock = vi.mocked(runCommandInherited)
const runtimeWithConfig = (cwd: string, config: Parameters<typeof mergeConfig>[0]) => ({ cwd, config: mergeConfig(config) })

afterEach(() => {
  vi.restoreAllMocks()
  processSpy.mockClear()
  runCommandInheritedMock.mockReset()
})

describe('release gate execution', () => {
  it('runs all configured stages by package configuration and scripts', () => {
    const npmExecPath = process.env.npm_execpath
    runCommandInheritedMock
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)

    delete process.env.npm_execpath

    runReleaseGate(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      releaseGate: {
        stages: [
          {
            name: 'manual-command',
            command: 'echo',
            args: ['ok'],
          },
          {
            name: 'backend-script',
            package: '@scope/backend',
            script: 'test',
          },
          {
            name: 'frontend-build',
            package: '@scope/frontend',
            files: ['apps/frontend-a.ts'],
          },
        ],
      },
    }), ['manual-command', 'backend-script', 'frontend-build'])

    if (typeof npmExecPath === 'undefined') {
      delete process.env.npm_execpath
    } else {
      process.env.npm_execpath = npmExecPath
    }

    expect(runCommandInheritedMock).toHaveBeenNthCalledWith(1, {
      command: 'echo',
      args: ['ok'],
    }, '/repo')
    expect(runCommandInheritedMock).toHaveBeenNthCalledWith(2, {
      command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      args: ['--filter', '@scope/backend', 'run', 'test'],
    }, '/repo')
    expect(runCommandInheritedMock).toHaveBeenNthCalledWith(3, {
      command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      args: ['--filter', '@scope/frontend', 'exec', 'vitest', 'run', 'apps/frontend-a.ts'],
    }, '/repo')

    expect(processSpy).not.toHaveBeenCalled()
  })

  it('rejects unknown requested stages and lists valid stage names', () => {
    expect(() => runReleaseGate(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      releaseGate: {
        stages: [{ name: 'ok-stage', command: 'echo', args: [] }],
      },
    }), ['missing-stage']))
      .toThrow('[release-gate] unknown stage(s): missing-stage')
  })

  it('requires releaseGate.stages to be configured', () => {
    expect(() => runReleaseGate(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
    }), []))
      .toThrow('releaseGate.stages is not configured.')
  })

  it('rejects stages without runnable command/script/package', () => {
    expect(() => runReleaseGate(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      releaseGate: {
        stages: [{ name: 'broken', command: undefined }],
      },
    }), []))
      .toThrow('Release gate stage "broken" must define command/args or package/files.')
  })

  it('exits early when a stage command fails', () => {
    runCommandInheritedMock.mockReturnValueOnce(1)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    expect(() => runReleaseGate(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      releaseGate: {
        stages: [{ name: 'first', command: 'echo', args: ['bad'] }],
      },
    }), []))
      .not.toThrow()

    expect(processExit).toHaveBeenCalledWith(1)
  })

  it('passes command arguments when provided for command stages', () => {
    runCommandInheritedMock.mockReturnValueOnce(0)

    runReleaseGate(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      releaseGate: {
        stages: [
          {
            name: 'custom-command',
            command: 'custom',
            args: ['--flag', 'value'],
          },
        ],
      },
    }), [])

    expect(runCommandInheritedMock).toHaveBeenCalledWith({
      command: 'custom',
      args: ['--flag', 'value'],
    }, '/repo')
  })

  it('runs all stages when no explicit stage list is provided', () => {
    runCommandInheritedMock
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)

    runReleaseGate(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      releaseGate: {
        stages: [
          {
            name: 'first',
            command: 'echo',
            args: ['ok'],
          },
          {
            name: 'second',
            package: '@scope/frontend',
            script: 'lint',
          },
        ],
      },
    }), [])

    expect(runCommandInheritedMock).toHaveBeenCalledTimes(2)
  })

  it('throws when package stages miss both script and files', () => {
    expect(() => runReleaseGate(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      releaseGate: {
        stages: [
          {
            name: 'broken',
            command: undefined as never,
            package: '@scope/backend',
            files: [],
          },
        ],
      },
    }), []))
      .toThrow('Release gate stage "broken" must define command/args or package/files.')
  })

  it('uses empty args list when command stage omits args', () => {
    runCommandInheritedMock.mockReturnValueOnce(0)

    runReleaseGate(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      releaseGate: {
        stages: [
          {
            name: 'custom-command',
            command: 'custom',
          },
        ],
      },
    }), ['custom-command'])

    expect(runCommandInheritedMock).toHaveBeenCalledWith({
      command: 'custom',
      args: [],
    }, '/repo')
  })
})
