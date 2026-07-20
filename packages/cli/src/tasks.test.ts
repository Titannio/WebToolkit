import { EventEmitter } from 'node:events'
import { PassThrough, Readable } from 'node:stream'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig } from './config.js'

const spawnMockCalls: Array<{ command: string; args: string[]; options: unknown }> = []

type TestSpawnProcess = EventEmitter & {
  stdout?: Readable
  stderr?: Readable
}

type TestRuntime = ReturnType<typeof runtimeWithConfig>

vi.mock('node:child_process', () => {
  const actual = vi.importActual('node:child_process')
  return {
    ...(actual as object),
    spawn: vi.fn(),
  }
})

vi.mock('./guard-runner.js', () => ({
  executeBuiltinGuard: vi.fn(),
}))

import { spawn } from 'node:child_process'
import { executeBuiltinGuard } from './guard-runner.js'
import { formatTaskStatusLine, listTaskCommands, normalizePassthroughArgs, printTaskHelp, resolveTaskName, runTask } from './tasks.js'

const runtimeWithConfig = (cwd: string, config: Parameters<typeof mergeConfig>[0]) => ({ cwd, config: mergeConfig(config) })

function mockSpawnSuccess(code: number) {
  return vi.mocked(spawn).mockImplementation((_command, args, options) => {
    const normalizedArgs = [...args]
    spawnMockCalls.push({ command: _command, args: normalizedArgs, options: options as unknown })
    const child = new EventEmitter() as TestSpawnProcess
    setTimeout(() => child.emit('close', code), 0)
    return child as ReturnType<typeof spawn>
  })
}

function mockSpawnWithOutput(code: number, output: string) {
  return vi.mocked(spawn).mockImplementation((_command, args, options) => {
    const normalizedArgs = [...args]
    spawnMockCalls.push({ command: _command, args: normalizedArgs, options: options as unknown })
    const child = new EventEmitter() as TestSpawnProcess
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    setTimeout(() => {
      child.stdout!.emit('data', Buffer.from(output))
      child.stderr!.emit('data', Buffer.from(''))
      child.emit('close', code)
    }, 0)
    return child as ReturnType<typeof spawn>
  })
}

function mockSpawnWithCloseCode(code: number | undefined) {
  return vi.mocked(spawn).mockImplementation((_command, args, options) => {
    const normalizedArgs = [...args]
    spawnMockCalls.push({ command: _command, args: normalizedArgs, options: options as unknown })
    const child = new EventEmitter() as ReturnType<typeof spawn>
    setTimeout(() => child.emit('close', code), 0)
    return child as ReturnType<typeof spawn>
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  spawnMockCalls.length = 0
  vi.mocked(spawn).mockReset()
  vi.mocked(executeBuiltinGuard).mockReset()
})

describe('task routing and helpers', () => {
  it('maps public command aliases', () => {
    expect(resolveTaskName('check')).toBe('check')
    expect(resolveTaskName('test-coverage')).toBe('testCoverage')
    expect(resolveTaskName('performance-bundle-audit')).toBe('performanceBundleAudit')
    expect(resolveTaskName('run:custom')).toBe('custom')
    expect(resolveTaskName('unknown')).toBeNull()
  })

  it('lists configured tasks in deterministic order', () => {
    const runtime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        zeta: { steps: [] },
        alpha: { steps: [] },
        beta: { steps: [] },
      },
    })

    expect(listTaskCommands(runtime.config)).toEqual(['alpha', 'beta', 'zeta'])
  })

  it('normalizes passthrough arguments', () => {
    expect(normalizePassthroughArgs(['--', '--filter', 'backend'])).toEqual(['--filter', 'backend'])
    expect(normalizePassthroughArgs(['--filter', 'backend'])).toEqual(['--filter', 'backend'])
  })

  it('formats status lines with and without progress', () => {
    expect(formatTaskStatusLine({ action: 'Running', label: 'core' })).toMatch(/core/)
    expect(formatTaskStatusLine({
      action: 'Building',
      label: 'API',
      status: 'OK',
      durationMs: 1050,
    })).toContain('1.05')
  })
})

describe('task execution', () => {
  it('runs all steps and throws on failures', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          title: 'Check',
          steps: [
            { label: 'A', command: 'pnpm', args: ['lint'] },
            { label: 'B', command: 'pnpm', args: ['test'], outputMode: 'buffered' },
          ],
        },
      },
    })

    mockSpawnSuccess(1)

    await expect(runTask('check', runtime, [])).rejects.toThrow('Task "check" failed.')
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1)
    expect(spawnMockCalls[0].command).toBe('pnpm')
    platform.mockRestore()
  })

  it('allows subsequent steps when failFast is disabled', async () => {
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          failFast: false,
          outputMode: 'buffered',
          steps: [
            { label: 'A', command: 'node', args: ['--version'], outputMode: 'buffered' },
            { label: 'B', command: 'node', args: ['--version'], outputMode: 'buffered' },
          ],
        },
      },
    })

    mockSpawnSuccess(0)

    await expect(runTask('check', runtime, ['--arg'])).resolves.toBeUndefined()
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2)
  })

  it('uses shell command wrapping for non-node tasks on Windows', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          steps: [
            { label: 'A', command: 'make', args: ['build'], cwd: 'packages/app' },
            { label: 'B', command: process.execPath, args: ['-e', 'console.log()'], cwd: 'C:/absolute' },
          ],
        },
      },
    })

    mockSpawnSuccess(0)

    await expect(runTask('check', runtime, ['--extra'])).resolves.toBeUndefined()
    expect(spawnMockCalls[0].command).toBe(process.env.ComSpec ?? 'cmd.exe')
    expect(spawnMockCalls[0].args[0]).toBe('/d')
    expect(spawnMockCalls[0].args[3]).toBe('make')
    expect(spawnMockCalls[1].command).toBe(process.execPath)
    platform.mockRestore()
  })

  it('shows available tasks when requested task is missing', async () => {
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        a: { steps: [] },
        b: { steps: [] },
      },
    })

    await expect(runTask('missing', runtime, []))
      .rejects
      .toThrow('Available tasks: a, b.')
  })

  it('prints buffered output on command failure', async () => {
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          outputMode: 'buffered',
          steps: [
            { label: 'A', command: 'node', args: ['--version'], outputMode: 'buffered' },
          ],
        },
      },
    })

    mockSpawnWithOutput(1, 'command failed output')

    await expect(runTask('check', runtime, ['--arg'])).rejects.toThrow('Task "check" failed.')
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1)
  })

  it('throws when task is not configured', async () => {
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {},
    })

    await expect(runTask('missing', runtime, []))
      .rejects
      .toThrow('Task "missing" is not configured.')
  })

  it('supports appendArgs by step and reports task help details for missing tasks', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    printTaskHelp('missing-task', runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        build: {
          steps: [
            { label: 'build', command: 'node', args: ['build'], appendArgs: true },
          ],
        },
      },
    }).config)

    expect(consoleInfo).toHaveBeenCalledWith('Task "missing-task" is not configured.')

    printTaskHelp('build', runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        build: {
          steps: [
            { label: 'build', command: 'node', args: ['build'], appendArgs: true },
          ],
        },
      },
    }).config)

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Additional arguments are appended to steps marked with appendArgs.'))
    consoleInfo.mockRestore()
  })

  it('includes passthrough args when appendArgs is enabled', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')

    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          steps: [
            { label: 'build', command: 'make', appendArgs: true },
          ],
        },
      },
    })

    mockSpawnSuccess(0)

    await runTask('check', runtime, ['--watch'])
    expect(spawnMockCalls[0].args).toEqual(['--watch'])
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('$ make --watch'))

    consoleInfo.mockRestore()
    platform.mockRestore()
  })

  it('uses the builtin command and default arguments in help output when not provided', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    printTaskHelp('build', runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        build: {
          steps: [
            { label: 'generate' },
          ],
        },
      },
    }).config)

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('- generate: <builtin>'))
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Steps:'))
    expect(consoleInfo).not.toHaveBeenCalledWith(expect.stringContaining('Additional arguments are appended'))
    consoleInfo.mockRestore()
  })

  it('skips remaining steps when failFast remains true', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          outputMode: 'buffered',
          steps: [
            { label: 'A', command: 'node', args: ['--version'], outputMode: 'buffered' },
            { label: 'B', command: 'node', args: ['--version'], outputMode: 'buffered' },
          ],
        },
      },
    })

    mockSpawnSuccess(1)
    await expect(runTask('check', runtime, [])).rejects.toThrow('Task "check" failed.')
    expect(spawnMockCalls).toHaveLength(1)
    platform.mockRestore()
  })

  it('resolves relative and absolute step working directories', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          outputMode: 'buffered',
          steps: [
            { label: 'abs', command: 'node', args: ['--version'], cwd: '/absolute' },
            { label: 'rel', command: 'node', args: ['--version'], cwd: 'packages/app' },
          ],
        },
      },
    })

    mockSpawnSuccess(0)
    await runTask('check', runtime, [])
    expect(spawnMockCalls[0].options).toMatchObject({ cwd: '/absolute' })
    expect(spawnMockCalls[1].options).toMatchObject({ cwd: path.join('/repo', 'packages/app') })
    platform.mockRestore()
  })

  it('throws for a step with missing command definition', async () => {
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          steps: [{ label: 'broken', command: undefined }],
        },
      },
    })

    await expect(runTask('check', runtime, []))
      .rejects
      .toThrow('Task step "broken" must define command or builtinGuard.')
  })

  it('formats command output with builtin placeholder when step command is missing', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          steps: [
            { label: 'build', args: ['--watch'] },
          ],
        },
      },
    })

    await expect(runTask('check', runtime, ['--value']))
      .rejects
      .toThrow('Task step "build" must define command or builtinGuard.')

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('$ <builtin> --watch'))
    consoleInfo.mockRestore()
  })

  it('formats build action when args include build', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          steps: [{ label: 'bundle', command: 'node', args: ['build', '--watch'] }],
        },
      },
    })

    mockSpawnSuccess(0)
    await runTask('check', runtime, [])
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Building'))
    consoleInfo.mockRestore()
  })

  it('does not append passthrough args when appendArgs is false', async () => {
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          outputMode: 'buffered',
          steps: [
            { label: 'lint', command: 'node', args: ['--version'] },
          ],
        },
      },
    })

    mockSpawnSuccess(0)

    await runTask('check', runtime, ['--extra', 'value'])
    expect(spawnMockCalls[0].args).toEqual(['--version'])
    expect(spawnMockCalls[0].args).not.toContain('--extra')
  })

  it('uses default cmd.exe when ComSpec is not defined on Windows', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const previousComSpec = process.env.ComSpec
    delete process.env.ComSpec
    try {
      const runtime: TestRuntime = runtimeWithConfig('/repo', {
        packageManager: 'pnpm',
        tasks: {
          check: {
            steps: [
              { label: 'build', command: 'make', args: ['build'] },
            ],
          },
        },
      })

      mockSpawnSuccess(0)

      await runTask('check', runtime, [])
      expect(spawnMockCalls[0].command).toBe('cmd.exe')
      expect(spawnMockCalls[0].args[3]).toBe('make')
    } finally {
      platform.mockRestore()
      if (previousComSpec === undefined) {
        delete process.env.ComSpec
      } else {
        process.env.ComSpec = previousComSpec
      }
    }
  })

  it('falls back to exit code 1 when child close code is undefined', async () => {
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          outputMode: 'buffered',
          steps: [
            { label: 'lint', command: 'node', args: ['--version'], outputMode: 'buffered' },
          ],
        },
      },
    })

    mockSpawnWithCloseCode(undefined)

    await expect(runTask('check', runtime, ['--arg']))
      .rejects
      .toThrow('Task "check" failed.')
    expect(spawnMockCalls[0].command).toBe('node')
  })

  it('prints no additional-args help message when no step appends args', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    printTaskHelp('build', runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        build: {
          steps: [{ label: 'lint', command: 'pnpm', args: ['lint'] }],
        },
      },
    }).config)

    expect(consoleInfo).not.toHaveBeenCalledWith(expect.stringContaining('Additional arguments are appended'))
    consoleInfo.mockRestore()
  })

  it('reports missing task when no tasks are defined', async () => {
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {},
    })

    await expect(runTask('missing', runtime, []))
      .rejects
      .toThrow('Task "missing" is not configured.')
  })

  it('runs builtin guard steps with configured and passthrough args', async () => {
    vi.mocked(executeBuiltinGuard).mockReturnValue(0)
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const runtime: TestRuntime = runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          steps: [
            { label: 'guard', builtinGuard: 'code-pattern', args: ['--root', 'src'], appendArgs: true },
          ],
        },
      },
    })

    await expect(runTask('check', runtime, ['--', '--changed'])).resolves.toBeUndefined()

    expect(executeBuiltinGuard).toHaveBeenCalledWith('code-pattern', ['--root', 'src', '--changed'], '/repo')
    expect(spawnMockCalls).toHaveLength(0)
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('$ webtoolkit guard code-pattern --root src --changed'))
    consoleInfo.mockRestore()
  })

  it('prints builtin guard commands in task help', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    printTaskHelp('check', runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      tasks: {
        check: {
          steps: [
            { label: 'guard', builtinGuard: 'documentation', args: ['--strict'] },
          ],
        },
      },
    }).config)

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('- guard: webtoolkit guard documentation --strict'))
    consoleInfo.mockRestore()
  })
})
