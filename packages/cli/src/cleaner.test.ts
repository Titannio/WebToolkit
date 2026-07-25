import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { promises as nodeFs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig } from './config.js'
import { parseCleanArgs, parseLevel, resolvePackageManagerCommand, runCleaner } from './cleaner.js'

const tempRoots: string[] = []
const originalInputIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const originalOutputIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
const cleanerMocks = vi.hoisted(() => ({
  close: vi.fn(),
  question: vi.fn().mockResolvedValue('2'),
  spawnSync: vi.fn().mockReturnValue({ status: 0 }),
}))

vi.mock('node:child_process', () => ({ spawnSync: cleanerMocks.spawnSync }))
vi.mock('node:readline/promises', () => ({
  default: {
    createInterface: () => ({ close: cleanerMocks.close, question: cleanerMocks.question }),
  },
}))

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-cli-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  vi.restoreAllMocks()
  cleanerMocks.close.mockClear()
  cleanerMocks.question.mockReset().mockResolvedValue('2')
  cleanerMocks.spawnSync.mockReset().mockReturnValue({ status: 0 })
  if (originalInputIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalInputIsTTY)
  else delete (process.stdin as { isTTY?: boolean }).isTTY
  if (originalOutputIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalOutputIsTTY)
  else delete (process.stdout as { isTTY?: boolean }).isTTY
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('clean command args', () => {
  it('parses levels and flags from long options', () => {
    expect(parseLevel(' empty ')).toBe('empty')
    expect(parseLevel('cache')).toBe('cache')
    expect(parseLevel('deep')).toBe('deep')
    expect(parseLevel('NUCLEAR')).toBe('nuclear')
    expect(parseLevel('bad')).toBeNull()
    expect(parseCleanArgs(['--level=nuclear', '--no-store-prune', '--interactive', '--reinstall=never'])).toEqual({
      level: 'nuclear',
      dryRun: false,
      noStorePrune: true,
      interactive: true,
      reinstall: 'never',
    })
  })

  it('respects short-form argument parsing', () => {
    expect(parseCleanArgs(['--', '--level', 'cache', '--dry-run'])).toEqual({
      level: 'cache',
      dryRun: true,
      noStorePrune: false,
      interactive: false,
      reinstall: 'ask',
    })
  })

  it('parses reinstall policies and rejects incomplete or unknown options', () => {
    expect(parseCleanArgs(['--reinstall', 'always'])).toMatchObject({ reinstall: 'always' })
    expect(parseCleanArgs(['--reinstall=ask'])).toMatchObject({ reinstall: 'ask' })
    expect(() => parseCleanArgs(['--level'])).toThrow('Missing value')
    expect(() => parseCleanArgs(['--level=bad'])).toThrow('Invalid level')
    expect(() => parseCleanArgs(['--level', 'bad'])).toThrow('Invalid level')
    expect(() => parseCleanArgs(['--reinstall'])).toThrow('Missing value')
    expect(() => parseCleanArgs(['--reinstall', 'sometimes'])).toThrow('Invalid reinstall policy')
    expect(() => parseCleanArgs(['--reinstall=sometimes'])).toThrow('Invalid reinstall policy')
    expect(() => parseCleanArgs(['--unknown'])).toThrow('Unknown option')
  })

  it('prints help and exits for both help flags', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)

    expect(() => parseCleanArgs(['--help'])).toThrow('exit')
    expect(() => parseCleanArgs(['-h'])).toThrow('exit')
    expect(info).toHaveBeenCalledWith('Usage: webtoolkit clean [options]')
    expect(exit).toHaveBeenCalledTimes(2)
  })

  it('wraps package manager through cmd.exe on Windows', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    try {
      expect(resolvePackageManagerCommand('pnpm', ['store', 'prune'])).toEqual({
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', 'pnpm', 'store', 'prune'],
      })
    } finally {
      platform.mockRestore()
    }
  })

  it('calls package manager directly outside Windows', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')

    try {
      expect(resolvePackageManagerCommand('pnpm', ['install', '--force'])).toEqual({
        command: 'pnpm',
        args: ['install', '--force'],
      })
    } finally {
      platform.mockRestore()
    }
  })
})

describe('cleaner behavior', () => {
  it('reports removable cache artifacts in dry-run mode without deleting them', async () => {
    const root = await createTempRoot()
    await mkdir(path.join(root, 'packages', 'app', '.turbo'), { recursive: true })
    await writeFile(path.join(root, 'packages', 'app', '.turbo', 'marker.txt'), 'cache')

    const removals = await runCleaner(parseCleanArgs(['--level=cache', '--dry-run']), {
      cwd: root,
      config: mergeConfig(),
    })

    expect(removals).toContainEqual({ kind: 'dir', relPath: path.join('packages', 'app', '.turbo') })
    await expect(readFile(path.join(root, 'packages', 'app', '.turbo', 'marker.txt'), 'utf8')).resolves.toBe('cache')
  })

  it('removes configured specific files in deep mode', async () => {
    const root = await createTempRoot()
    const generatedFile = path.join(root, 'apps', 'frontend-user', 'src', 'setup-env.js')
    await mkdir(path.dirname(generatedFile), { recursive: true })
    await writeFile(generatedFile, 'generated')

    const removals = await runCleaner(parseCleanArgs(['--level=deep']), {
      cwd: root,
      config: mergeConfig({
        cleaner: {
          levels: {
            deep: {
              removableSpecificFiles: ['apps/frontend-user/src/setup-env.js'],
            },
          },
        },
      }),
    })

    expect(removals).toContainEqual({
      kind: 'file',
      relPath: path.join('apps', 'frontend-user', 'src', 'setup-env.js'),
    })
    await expect(readFile(generatedFile, 'utf8')).rejects.toThrow()
  })

  it('removes every configured artifact kind only at workspace roots', async () => {
    const root = await createTempRoot()
    const app = path.join(root, 'packages', 'app')
    await mkdir(path.join(app, 'cache-dir'), { recursive: true })
    await mkdir(path.join(app, '.git', 'cache-dir'), { recursive: true })
    await mkdir(path.join(app, 'nested', 'cache-dir'), { recursive: true })
    await writeFile(path.join(app, 'named.tmp'), 'named')
    await writeFile(path.join(app, 'bundle.remove'), 'suffix')
    await writeFile(path.join(app, 'prefix-output'), 'prefix')
    await writeFile(path.join(app, 'match.LOG'), 'pattern')
    await writeFile(path.join(app, 'keep.txt'), 'keep')

    const removals = await runCleaner(parseCleanArgs(['--level=deep']), {
      cwd: root,
      config: mergeConfig({
        cleaner: {
          levels: {
            deep: {
              removeEmptyDirs: false,
              removableDirNames: ['cache-dir'],
              removableFileNames: ['named.tmp'],
              removableFileSuffixes: ['.remove'],
              removableFilePrefixes: ['prefix-'],
              removableFilePatterns: ['^match\\.log$'],
            },
          },
        },
      }),
    })

    expect(removals).toEqual(expect.arrayContaining([
      { kind: 'dir', relPath: path.join('packages', 'app', 'cache-dir') },
      { kind: 'file', relPath: path.join('packages', 'app', 'named.tmp') },
      { kind: 'file', relPath: path.join('packages', 'app', 'bundle.remove') },
      { kind: 'file', relPath: path.join('packages', 'app', 'prefix-output') },
      { kind: 'file', relPath: path.join('packages', 'app', 'match.LOG') },
    ]))
    await expect(stat(path.join(app, '.git', 'cache-dir'))).resolves.toBeDefined()
    await expect(stat(path.join(app, 'nested', 'cache-dir'))).resolves.toBeDefined()
    await expect(readFile(path.join(app, 'keep.txt'), 'utf8')).resolves.toBe('keep')
  })

  it('removes nested empty directories while preserving protected and skipped roots', async () => {
    const root = await createTempRoot()
    await mkdir(path.join(root, 'remove-me', 'nested'), { recursive: true })
    await mkdir(path.join(root, 'apps'), { recursive: true })
    await mkdir(path.join(root, '.git'), { recursive: true })
    await writeFile(path.join(root, 'file.txt'), 'keep')

    const removals = await runCleaner(parseCleanArgs(['--level=empty']), {
      cwd: root,
      config: mergeConfig(),
    })

    expect(removals).toEqual([
      { kind: 'empty-dir', relPath: path.join('remove-me', 'nested') },
      { kind: 'empty-dir', relPath: 'remove-me' },
    ])
    await expect(readFile(path.join(root, 'file.txt'), 'utf8')).resolves.toBe('keep')
    await expect(stat(path.join(root, 'apps'))).resolves.toBeDefined()
    await expect(stat(path.join(root, '.git'))).resolves.toBeDefined()
  })

  it('tolerates filesystem entries that disappear during empty-directory cleanup', async () => {
    const root = await createTempRoot()
    await mkdir(path.join(root, 'vanished'))
    const realReaddir = nodeFs.readdir.bind(nodeFs)
    vi.spyOn(nodeFs, 'readdir')
      .mockRejectedValueOnce(new Error('vanished root'))
      .mockImplementation(realReaddir)
    await expect(runCleaner(parseCleanArgs(['--level=empty']), {
      cwd: root,
      config: mergeConfig(),
    })).resolves.toEqual([])

    vi.mocked(nodeFs.readdir).mockRestore()
    vi.spyOn(nodeFs, 'stat').mockRejectedValueOnce(new Error('vanished entry'))
    await expect(runCleaner(parseCleanArgs(['--level=empty']), {
      cwd: root,
      config: mergeConfig(),
    })).resolves.toEqual([])
  })

  it('reports singular dry-run summaries and nuclear completion', async () => {
    const dryRoot = await createTempRoot()
    await mkdir(path.join(dryRoot, 'only-empty'))
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await runCleaner(parseCleanArgs(['--level=empty', '--dry-run']), { cwd: dryRoot, config: mergeConfig() })

    const nuclearRoot = await createTempRoot()
    await mkdir(path.join(nuclearRoot, 'node_modules'))
    await runCleaner(parseCleanArgs(['--level=nuclear', '--no-store-prune', '--reinstall=never']), {
      cwd: nuclearRoot,
      config: mergeConfig(),
    })

    expect(info.mock.calls.flat().join('\n')).toContain('1 empty directory')
    expect(info.mock.calls.flat().join('\n')).toContain('Nuclear cleanup completed')
    expect(info.mock.calls.flat().join('\n')).toContain('Skipped dependency reinstall')
  })

  it('falls back to default level when interactive mode is disabled and no level is chosen', async () => {
    const root = await createTempRoot()
    await runCleaner({ ...parseCleanArgs([]) }, { cwd: root, config: mergeConfig() })
    await expect(rm(root, { recursive: true, force: true })).resolves.toBeUndefined()
  })

  it.each([
    ['', 'cache'],
    ['1', 'empty'],
    ['3', 'deep'],
    ['4', 'nuclear'],
  ] as const)('chooses interactive answer %j as %s', async (answer, expectedLevel) => {
    const root = await createTempRoot()
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    cleanerMocks.question.mockResolvedValue(answer)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await runCleaner({ ...parseCleanArgs(['--interactive']), reinstall: 'never', noStorePrune: true }, {
      cwd: root,
      config: mergeConfig(),
    })

    expect(info.mock.calls.flat().join('\n')).toContain(mergeConfig().cleaner.levels[expectedLevel].label)
    expect(cleanerMocks.close).toHaveBeenCalled()
  })

  it('rejects invalid interactive choices and non-TTY interactive mode', async () => {
    const root = await createTempRoot()
    await expect(runCleaner(parseCleanArgs(['--interactive']), { cwd: root, config: mergeConfig() }))
      .rejects.toThrow('requires a TTY')

    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    cleanerMocks.question.mockResolvedValue('invalid')
    await expect(runCleaner(parseCleanArgs(['--interactive']), { cwd: root, config: mergeConfig() }))
      .rejects.toThrow('Invalid level choice')
    expect(cleanerMocks.close).toHaveBeenCalled()
  })

  it('runs nuclear prune and forced reinstall policies', async () => {
    const root = await createTempRoot()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await runCleaner(parseCleanArgs(['--level=nuclear', '--reinstall=always']), {
      cwd: root,
      config: mergeConfig(),
    })

    expect(cleanerMocks.spawnSync).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.arrayContaining(['store', 'prune']),
      expect.objectContaining({ cwd: root }),
    )
    expect(cleanerMocks.spawnSync).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.arrayContaining(['install', '--force']),
      expect.any(Object),
    )
  })

  it('handles ask reinstall in non-interactive and interactive shells', async () => {
    const nonInteractiveRoot = await createTempRoot()
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await runCleaner(parseCleanArgs(['--level=nuclear', '--no-store-prune']), {
      cwd: nonInteractiveRoot,
      config: mergeConfig(),
    })

    const interactiveRoot = await createTempRoot()
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    cleanerMocks.question.mockResolvedValue('sim')
    await runCleaner(parseCleanArgs(['--level=nuclear', '--no-store-prune']), {
      cwd: interactiveRoot,
      config: mergeConfig(),
    })

    expect(info.mock.calls.flat().join('\n')).toContain('not interactive')
    expect(cleanerMocks.spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['install', '--force']),
      expect.any(Object),
    )
    expect(cleanerMocks.close).toHaveBeenCalled()
  })

  it('surfaces package-manager spawn and exit failures', async () => {
    const root = await createTempRoot()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    cleanerMocks.spawnSync.mockReturnValueOnce({ error: new Error('missing') })
    await expect(runCleaner(parseCleanArgs(['--level=nuclear', '--reinstall=never']), {
      cwd: root,
      config: mergeConfig(),
    })).rejects.toThrow('Failed to run')

    cleanerMocks.spawnSync.mockReturnValueOnce({ status: 2 })
    await expect(runCleaner(parseCleanArgs(['--level=nuclear', '--reinstall=never']), {
      cwd: root,
      config: mergeConfig(),
    })).rejects.toThrow('exit code 2')
  })
})
