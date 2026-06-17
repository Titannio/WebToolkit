import { afterEach, describe, expect, it, vi } from 'vitest'

import { printGuardHelp, executeBuiltinGuard, runBuiltinGuard } from './guard-runner.js'

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawnSync: vi.fn(),
  }
})

import { spawnSync } from 'node:child_process'

const spawnSyncMock = vi.mocked(spawnSync)

afterEach(() => {
  vi.restoreAllMocks()
  spawnSyncMock.mockReset()
})

describe('guard runner', () => {
  it('lists builtin guard names in help output', () => {
    const logs: string[] = []
    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => logs.push(String(message)))

    printGuardHelp()

    expect(logs.some((line) => line.includes('Builtin guards:'))).toBe(true)
    expect(logs.some((line) => line.includes('singleton-deps'))).toBe(true)
  })

  it('throws for unknown builtin guards and preserves known names', () => {
    expect(() => executeBuiltinGuard('nope', [], '/tmp/project')).toThrow('Unknown builtin guard "nope"')
  })

  it('runs a known builtin guard through child process and returns exit status', () => {
    spawnSyncMock.mockReturnValue({ status: 7, error: undefined } as never)

    const status = executeBuiltinGuard('any', ['--help'], '/repo')

    expect(status).toBe(7)
        const called = spawnSyncMock.mock.calls[0]
        expect(called[0]).toBe(process.execPath)
        const resolvedGuardArg = String(called?.[1]?.[0] ?? '')
        expect(resolvedGuardArg).toContain('any-guard.js')
        expect(called?.[1]).toContain('--help')
        expect(called?.[2]).toMatchObject({ cwd: '/repo', env: expect.objectContaining({ FORCE_COLOR: '1' }) })
        expect(called?.[2]).toMatchObject({ cwd: '/repo', env: expect.objectContaining({ FORCE_COLOR: '1' }) })
      })

  it('returns status 1 when guard exits without status and throws when the process errored', () => {
    spawnSyncMock.mockReturnValueOnce({ status: undefined, error: undefined } as never)
    expect(executeBuiltinGuard('any', [], '/repo')).toBe(1)

    spawnSyncMock.mockReset()
    const error = new Error('spawn failed')
    spawnSyncMock.mockReturnValueOnce({ status: 1, error } as never)
    expect(() => executeBuiltinGuard('any', [], '/repo')).toThrow(error)
  })

  it('terminates process when a builtin guard is wrapped as a top-level command', () => {
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
    spawnSyncMock.mockReturnValue({ status: 0, error: undefined } as never)

    expect(() => runBuiltinGuard('docs-inventory', [], '/repo')).toThrow('exit')
    expect(processExit).toHaveBeenCalledWith(0)
  })
})
