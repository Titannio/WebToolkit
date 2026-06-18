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

  it('starts terminal windows and runs each generated command', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    vi.mocked(spawnSync).mockImplementation((command, args, options) => {
      spawnCalls.push({
        command: String(command),
        args: [...(args ?? [])],
        options,
      })
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
})
