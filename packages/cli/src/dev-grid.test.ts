import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig } from './config.js'
import { runDevGrid } from './dev-grid.js'
import { runCommandInherited } from './process.js'

vi.mock('./process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./process.js')>()
  return { ...actual, runCommandInherited: vi.fn() }
})

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

const runtimeWithConfig = (cwd: string, config: Parameters<typeof mergeConfig>[0]) => ({ cwd, config: mergeConfig(config) })
type SpawnSyncCall = { command: string; args: string[]; options: unknown }
const spawnCalls: SpawnSyncCall[] = []
const temporaryDirectories: string[] = []
const originalLocalAppData = process.env.LOCALAPPDATA

function mockWindowsTerminal(available = true): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
  vi.mocked(spawnSync).mockImplementation((command, args, options) => {
    spawnCalls.push({ command: String(command), args: [...(args ?? [])], options })
    if (command === 'where.exe') return { status: available ? 0 : 1, stdout: '', stderr: '' } as never
    return { status: 0, stdout: 'ok', stderr: '' } as never
  })
  vi.mocked(runCommandInherited).mockReturnValue(0)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(spawnSync).mockReset()
  vi.mocked(runCommandInherited).mockReset()
  spawnCalls.length = 0
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = originalLocalAppData
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('dev-grid runtime', () => {
  it('falls back to the configured script outside Windows', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux' as NodeJS.Platform)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' } as never)

    runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        layout: { rows: [{ panes: [{ title: 'A', command: 'echo A' }] }] },
        fallbackScript: 'npm run dev-grid',
      },
    }), ['--silent', '--dry-run'])

    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"args": [\n    "run",\n    "dev-grid"\n  ]'))
    expect(processExit).toHaveBeenCalledWith(0)
  })

  it('uses the fallback when Windows Terminal is unavailable', () => {
    mockWindowsTerminal(false)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        layout: { rows: [{ panes: [{ title: 'A', command: 'echo A' }] }] },
        fallbackScript: 'npm run dev-grid',
      },
    }), [])

    expect(processExit).toHaveBeenCalledWith(0)
    expect(spawnCalls).toContainEqual(expect.objectContaining({
      command: 'pnpm.cmd',
      args: ['run', 'dev-grid'],
      options: expect.objectContaining({ env: expect.objectContaining({ FORCE_COLOR: '1' }) }),
    }))
  })

  it('builds equal rows and equal columns from the configured layout', () => {
    mockWindowsTerminal()

    runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        layout: {
          rows: [
            {
              panes: [
                { title: 'Frontend 1', command: 'front-1' },
                { title: 'Frontend 2', command: 'front-2' },
                { title: 'Frontend 3', command: 'front-3' },
                { title: 'Frontend 4', command: 'front-4' },
              ],
            },
            { panes: [{ title: 'Backend', command: 'backend' }] },
          ],
        },
      },
    }), [])

    const commands = spawnCalls.filter((entry) => entry.command === 'wt.exe').map((entry) => entry.args)
    expect(commands).toHaveLength(7)
    expect(commands[0]).toEqual(expect.arrayContaining([
      'new-tab',
      '--title',
      'Frontend 1',
      '-Command',
      "$env:FORCE_COLOR = '1'\nfront-1",
    ]))
    expect(commands[1]).toEqual(expect.arrayContaining(['split-pane', '--horizontal', '--size', '0.5', '--title', 'Backend']))
    expect(commands[2]).toEqual(expect.arrayContaining(['move-focus', 'first']))
    expect(commands[3]).toEqual(expect.arrayContaining(['split-pane', '--vertical', '--size', '0.75', '--title', 'Frontend 2']))
    expect(commands[4]).toEqual(expect.arrayContaining(['split-pane', '--vertical', '--size', '0.666667', '--title', 'Frontend 3']))
    expect(commands[5]).toEqual(expect.arrayContaining(['split-pane', '--vertical', '--size', '0.5', '--title', 'Frontend 4']))
    expect(commands[6]).toEqual(expect.arrayContaining(['move-focus', 'down']))
  })

  it('opens every pane in a single configured row', () => {
    mockWindowsTerminal()

    runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        layout: {
          rows: [{
            panes: [
              { title: 'A', command: 'echo A' },
              { title: 'B', command: 'echo B' },
              { title: 'C', command: 'echo C' },
            ],
          }],
        },
      },
    }), [])

    const commands = spawnCalls.filter((entry) => entry.command === 'wt.exe').map((entry) => entry.args)
    expect(commands).toHaveLength(3)
    expect(commands.flat()).not.toContain('--horizontal')
    expect(commands[1]).toEqual(expect.arrayContaining(['--vertical', '--size', '0.666667']))
    expect(commands[2]).toEqual(expect.arrayContaining(['--vertical', '--size', '0.5']))
  })

  it('uses a temporary profile for pane font size', () => {
    mockWindowsTerminal()
    const localAppData = mkdtempSync(join(tmpdir(), 'webtoolkit-dev-grid-'))
    temporaryDirectories.push(localAppData)
    process.env.LOCALAPPDATA = localAppData

    runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        layout: {
          rows: [{ panes: [{ title: 'A', command: 'echo A', fontSize: 16 }] }],
        },
      },
    }), [])

    const wtCall = spawnCalls.find((entry) => entry.command === 'wt.exe')
    expect(wtCall?.args).toEqual(expect.arrayContaining(['--profile', expect.stringContaining('WebToolkit Dev Grid')]))

    const fragmentPath = join(localAppData, 'Microsoft', 'Windows Terminal', 'Fragments', 'WebToolkit.Cli', 'dev-grid.json')
    expect(JSON.parse(readFileSync(fragmentPath, 'utf8'))).toEqual({
      profiles: [expect.objectContaining({ hidden: true, fontSize: 16, commandline: 'pwsh' })],
    })
  })

  it('does not persist pane profiles during a Windows dry run', () => {
    mockWindowsTerminal()
    const localAppData = mkdtempSync(join(tmpdir(), 'webtoolkit-dev-grid-'))
    temporaryDirectories.push(localAppData)
    process.env.LOCALAPPDATA = localAppData
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    runDevGrid(runtimeWithConfig('/repo', {
      devGrid: {
        layout: {
          rows: [{ panes: [{ title: 'A', command: 'echo A', fontSize: 16 }] }],
        },
      },
    }), ['--dry-run'])

    const fragmentPath = join(localAppData, 'Microsoft', 'Windows Terminal', 'Fragments', 'WebToolkit.Cli', 'dev-grid.json')
    expect(existsSync(fragmentPath)).toBe(false)
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('WebToolkit Dev Grid'))
    expect(spawnCalls.some((entry) => entry.command === 'wt.exe')).toBe(false)
  })

  it('rejects empty layouts, empty rows, and invalid font sizes', () => {
    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      devGrid: { layout: { rows: [] } },
    }), [])).toThrow('devGrid.layout.rows is not configured.')

    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      devGrid: { layout: { rows: [{ panes: [] }] } },
    }), [])).toThrow('devGrid.layout.rows[0].panes is not configured.')

    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      devGrid: {
        layout: { rows: [{ panes: [{ title: 'A', command: 'echo A', fontSize: 0 }] }] },
      },
    }), [])).toThrow('invalid fontSize 0')

    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      devGrid: {
        layout: { rows: [{ panes: [{ title: 'A', command: 'echo A', fontSize: 1.5 }] }] },
      },
    }), [])).toThrow('invalid fontSize 1.5')

    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      devGrid: {
        layout: { rows: [{ panes: [{ title: 'A', command: 'echo A', fontSize: -1 }] }] },
      },
    }), [])).toThrow('invalid fontSize -1')
  })

  it('uses silent pane commands and falls back to the regular command', () => {
    mockWindowsTerminal()

    runDevGrid(runtimeWithConfig('/repo', {
      devGrid: {
        layout: {
          rows: [{
            panes: [
              { title: 'A', command: 'normal-a', silentCommand: 'silent-a' },
              { title: 'B', command: 'normal-b' },
            ],
          }],
        },
      },
    }), ['--silent'])

    const commands = spawnCalls.filter((entry) => entry.command === 'wt.exe').flatMap((entry) => entry.args)
    expect(commands).toContain("$env:FORCE_COLOR = '1'\nsilent-a")
    expect(commands).toContain("$env:FORCE_COLOR = '1'\nnormal-b")
  })

  it('uses Windows PowerShell when pwsh is unavailable', () => {
    mockWindowsTerminal()
    vi.mocked(spawnSync).mockImplementation((command, args, options) => {
      spawnCalls.push({ command: String(command), args: [...(args ?? [])], options })
      if (command === 'where.exe' && args?.[0] === 'pwsh') return { status: 1 } as never
      return { status: 0, stdout: '', stderr: '' } as never
    })

    runDevGrid(runtimeWithConfig('/repo', {
      devGrid: { layout: { rows: [{ panes: [{ title: 'A', command: 'a' }] }] } },
    }), [])

    expect(spawnCalls.find((entry) => entry.command === 'wt.exe')?.args).toContain('powershell.exe')
  })

  it('requires LOCALAPPDATA only when a profile must be persisted', () => {
    mockWindowsTerminal()
    delete process.env.LOCALAPPDATA
    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      devGrid: { layout: { rows: [{ panes: [{ title: 'A', command: 'a', fontSize: 12 }] }] } },
    }), [])).toThrow('LOCALAPPDATA is not defined')
  })

  it('runs preflight and propagates its exit code', () => {
    mockWindowsTerminal()
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.mocked(runCommandInherited).mockReturnValue(3)

    runDevGrid(runtimeWithConfig('/repo', {
      devGrid: {
        preflightCommand: { label: 'preflight', command: 'node', cwd: 'app', env: { A: '1' } },
        layout: { rows: [{ panes: [{ title: 'A', command: 'a' }] }] },
      },
    }), [])

    expect(runCommandInherited).toHaveBeenCalledWith({
      command: 'node',
      args: [],
      cwd: 'app',
      env: { A: '1' },
    }, '/repo')
    expect(processExit).toHaveBeenCalledWith(3)
  })

  it('rejects a preflight without a command', () => {
    mockWindowsTerminal()
    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      devGrid: {
        preflightCommand: { label: 'preflight' } as never,
        layout: { rows: [{ panes: [{ title: 'A', command: 'a' }] }] },
      },
    }), [])).toThrow('must define command')
  })

  it.each([
    ['linux' as NodeJS.Platform, 'Windows Terminal grid is unavailable'],
    ['win32' as NodeJS.Platform, 'Windows Terminal (`wt.exe`) is unavailable'],
  ])('requires fallbackScript when the grid is unavailable on %s', (platform, message) => {
    if (platform === 'win32') mockWindowsTerminal(false)
    else vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      devGrid: { layout: { rows: [{ panes: [{ title: 'A', command: 'a' }] }] } },
    }), [])).toThrow(message)
  })

  it('normalizes a bare fallback script and maps a null status to failure', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.mocked(spawnSync).mockReturnValue({ status: null } as never)

    runDevGrid(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      devGrid: {
        fallbackScript: '  dev:grid   silent ',
        layout: { rows: [{ panes: [{ title: 'A', command: 'a' }] }] },
      },
    }), [])

    expect(spawnSync).toHaveBeenCalledWith('pnpm', ['run', 'dev:grid silent'], expect.any(Object))
    expect(processExit).toHaveBeenCalledWith(1)
  })

  it('propagates fallback spawn errors', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.mocked(spawnSync).mockReturnValue({ error: new Error('spawn failed') } as never)
    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      devGrid: {
        fallbackScript: 'dev',
        layout: { rows: [{ panes: [{ title: 'A', command: 'a' }] }] },
      },
    }), [])).toThrow('spawn failed')
  })

  it.each([
    [{ error: new Error('wt spawn failed') }, 'wt spawn failed'],
    [{ status: 1, stderr: 'stderr detail', stdout: '' }, 'stderr detail'],
    [{ status: 1, stderr: '', stdout: 'stdout detail' }, 'stdout detail'],
    [{ status: 1, stderr: '', stdout: '' }, 'exit code 1'],
  ])('reports Windows Terminal failures: %j', (result, message) => {
    mockWindowsTerminal()
    vi.mocked(spawnSync).mockImplementation((command, args, options) => {
      spawnCalls.push({ command: String(command), args: [...(args ?? [])], options })
      if (command === 'where.exe') return { status: 0 } as never
      return result as never
    })
    expect(() => runDevGrid(runtimeWithConfig('/repo', {
      devGrid: { layout: { rows: [{ panes: [{ title: 'A', command: 'a' }] }] } },
    }), [])).toThrow(message)
  })
})
