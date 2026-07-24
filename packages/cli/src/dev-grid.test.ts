import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
    expect(spawnCalls.some((entry) => entry.command === 'pnpm.cmd' && entry.args.join(' ') === 'run dev-grid')).toBe(true)
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
    expect(commands[0]).toEqual(expect.arrayContaining(['new-tab', '--title', 'Frontend 1']))
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
  })
})
