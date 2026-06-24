import { afterEach, describe, expect, it, vi } from 'vitest'

import { runDevGrid } from './dev-grid.js'
import { mergeConfig } from './config.js'

vi.mock('./process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./process.js')>()
  return {
    ...actual,
    runCommandInherited: vi.fn(),
  }
})

vi.mock('node:child_process', () => {
  const actual = vi.importActual('node:child_process')
  return {
    ...(actual as object),
    spawnSync: vi.fn(),
  }
})

import { spawnSync } from 'node:child_process'
import { runCommandInherited } from './process.js'

const runtimeWithConfig = (cwd: string, config: Parameters<typeof mergeConfig>[0]) => ({ cwd, config: mergeConfig(config) })
type SpawnSyncCall = { command: string; args: string[]; options: unknown }
const spawnCalls: SpawnSyncCall[] = []

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(spawnSync).mockReset()
  vi.mocked(runCommandInherited).mockReset()
  spawnCalls.length = 0
})

describe('dev-grid runtime', () => {
  it('falls back to script on non-Windows platforms', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux' as NodeJS.Platform)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' } as never)

    await runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        panes: [{ title: 'A', command: 'echo' }],
        fallbackScript: 'npm run dev-grid',
      },
    }), ['--silent', '--dry-run'])

    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"args": [\n    "run",\n    "dev-grid"\n  ]'))
    expect(processExit).toHaveBeenCalledWith(0)
    platform.mockRestore()
    processExit.mockRestore()
  })

  it('uses fallback script when Windows Terminal is missing', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.mocked(runCommandInherited).mockReturnValue(0)
    vi.mocked(spawnSync).mockImplementation((command, args, options) => {
      spawnCalls.push({
        command: String(command),
        args: [...(args ?? [])],
        options,
      })
      if (typeof command === 'string' && command.includes('where')) {
        return { status: 1, stdout: '', stderr: '' } as never
      }
      return { status: 0, stdout: '', stderr: '' } as never
    })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        panes: [{ title: 'A', command: 'echo' }],
        fallbackScript: 'npm run dev-grid',
      },
    }), [])).not.toThrow()

    expect(processExit).toHaveBeenCalledWith(0)
    expect(spawnCalls.some((entry) => entry.command === 'pnpm.cmd' && entry.args.join(' ') === 'run dev-grid')).toBe(true)
    expect(consoleError).not.toHaveBeenCalled()
    platform.mockRestore()
    processExit.mockRestore()
  })

  it('limits panes using maxPanels', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    vi.mocked(spawnSync).mockImplementation((command, args, options) => {
      spawnCalls.push({
        command: String(command),
        args: [...(args ?? [])],
        options,
      })
      if (typeof command === 'string' && command.includes('where')) {
        return { status: 0, stdout: '', stderr: '' } as never
      }
      return { status: 0, stdout: '', stderr: '' } as never
    })

    vi.mocked(runCommandInherited).mockReturnValue(0)

    await runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        maxPanels: 2,
        panes: [
          { title: 'A', command: 'echo A' },
          { title: 'B', command: 'echo B' },
          { title: 'C', command: 'echo C' },
        ],
      },
    }), [])

    const wtCalls = spawnCalls.filter((entry) => entry.command === 'wt.exe')
    expect(wtCalls).toHaveLength(2)
    platform.mockRestore()
  })

  it('adds per-pane font size to generated pane args', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    vi.mocked(spawnSync).mockImplementation((command, args, options) => {
      spawnCalls.push({
        command: String(command),
        args: [...(args ?? [])],
        options,
      })
      if (typeof command === 'string' && command.includes('where')) {
        return { status: 0, stdout: '', stderr: '' } as never
      }
      return { status: 0, stdout: 'ok', stderr: '' } as never
    })

    vi.mocked(runCommandInherited).mockReturnValue(0)

    await runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        panes: [
          { title: 'A', command: 'echo A', fontSize: 16 },
        ],
      },
    }), [])

    const wtCalls = spawnCalls.filter((entry) => entry.command === 'wt.exe')
    expect(wtCalls).toHaveLength(1)
    expect(wtCalls[0].args).toEqual(expect.arrayContaining(['--fontSize', '16']))
    platform.mockRestore()
  })

  it('supports fullWidth pane as the first pane', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    vi.mocked(spawnSync).mockImplementation((command, args, options) => {
      spawnCalls.push({
        command: String(command),
        args: [...(args ?? [])],
        options,
      })
      if (typeof command === 'string' && command.includes('where')) {
        return { status: 0, stdout: '', stderr: '' } as never
      }
      return { status: 0, stdout: 'ok', stderr: '' } as never
    })

    vi.mocked(runCommandInherited).mockReturnValue(0)

    await runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        panes: [
          { title: 'A', command: 'echo A', fullWidth: true },
          { title: 'B', command: 'echo B' },
          { title: 'C', command: 'echo C' },
        ],
      },
    }), [])

    const wtCalls = spawnCalls.filter((entry) => entry.command === 'wt.exe')
    expect(wtCalls).toHaveLength(3)
    expect(wtCalls[1].args).toContain('--horizontal')
    expect(wtCalls[2].args).toContain('--vertical')
    platform.mockRestore()
  })

  it('starts terminal windows and runs each generated command', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    vi.mocked(spawnSync).mockImplementation((command, args, options) => {
      spawnCalls.push({
        command: String(command),
        args: [...(args ?? [])],
        options,
      })
      if (typeof command === 'string' && command.includes('where')) {
        return { status: 0, stdout: '', stderr: '' } as never
      }
      return { status: 0, stdout: 'ok', stderr: '' } as never
    })

    vi.mocked(runCommandInherited).mockReturnValue(0)

    await runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        panes: [
          { title: 'A', command: 'echo A' },
        ],
      },
    }), [])

    expect(spawnCalls.some((entry) => entry.command === 'wt.exe')).toBe(true)
    platform.mockRestore()
  })

  it('rejects invalid maxPanels values', () => {
    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        maxPanels: 0,
        panes: [{ title: 'A', command: 'echo A' }],
      },
    }), [])).toThrow('devGrid.maxPanels must be a positive integer.')
  })

  it('supports fullWidth in middle with additional non-fullWidth panes', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    vi.mocked(spawnSync).mockImplementation((command, args, options) => {
      spawnCalls.push({
        command: String(command),
        args: [...(args ?? [])],
        options,
      })
      if (typeof command === 'string' && command.includes('where')) {
        return { status: 0, stdout: '', stderr: '' } as never
      }
      return { status: 0, stdout: 'ok', stderr: '' } as never
    })

    vi.mocked(runCommandInherited).mockReturnValue(0)

    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        panes: [
          { title: 'A', command: 'echo A' },
          { title: 'B', command: 'echo B', fullWidth: true },
          { title: 'C', command: 'echo C' },
          { title: 'D', command: 'echo D' },
        ],
      },
    }), [])).not.toThrow()

    const wtCalls = spawnCalls.filter((entry) => entry.command === 'wt.exe')
    expect(wtCalls).toHaveLength(4)
    platform.mockRestore()
  })

  it('supports fullWidth with maxPanels', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    vi.mocked(spawnSync).mockImplementation((command, args, options) => {
      spawnCalls.push({
        command: String(command),
        args: [...(args ?? [])],
        options,
      })
      if (typeof command === 'string' && command.includes('where')) {
        return { status: 0, stdout: '', stderr: '' } as never
      }
      return { status: 0, stdout: 'ok', stderr: '' } as never
    })

    vi.mocked(runCommandInherited).mockReturnValue(0)

    await runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        maxPanels: 4,
        panes: [
          { title: 'A', command: 'echo A' },
          { title: 'B', command: 'echo B', fullWidth: true },
          { title: 'C', command: 'echo C' },
          { title: 'D', command: 'echo D' },
          { title: 'E', command: 'echo E' },
        ],
      },
    }), [])

    const wtCalls = spawnCalls.filter((entry) => entry.command === 'wt.exe')
    expect(wtCalls).toHaveLength(4)
    expect(wtCalls[1].args).toContain('--horizontal')
    expect(wtCalls[3].args).toContain('--vertical')
    platform.mockRestore()
  })

  it('opens all panes when maxPanels is not set', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    vi.mocked(spawnSync).mockImplementation((command, args, options) => {
      spawnCalls.push({
        command: String(command),
        args: [...(args ?? [])],
        options,
      })
      if (typeof command === 'string' && command.includes('where')) {
        return { status: 0, stdout: '', stderr: '' } as never
      }
      return { status: 0, stdout: 'ok', stderr: '' } as never
    })

    vi.mocked(runCommandInherited).mockReturnValue(0)

    await runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        panes: [
          { title: 'A', command: 'echo A' },
          { title: 'B', command: 'echo B' },
          { title: 'C', command: 'echo C' },
          { title: 'D', command: 'echo D' },
          { title: 'E', command: 'echo E' },
        ],
      },
    }), [])

    const wtCalls = spawnCalls.filter((entry) => entry.command === 'wt.exe')
    expect(wtCalls).toHaveLength(7)
    platform.mockRestore()
  })

  it('rejects more than one fullWidth pane', () => {
    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        panes: [
          { title: 'A', command: 'echo A', fullWidth: true },
          { title: 'B', command: 'echo B', fullWidth: true },
        ],
      },
    }), [])).toThrow('devGrid supports at most one pane with fullWidth: true.')
  })
})
