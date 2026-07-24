import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RepositoryHygieneGuardConfig } from '../config.js'
import {
  inspectTrackedPaths,
  readTrackedFiles,
  runRepositoryHygieneGuard,
} from './repository-hygiene-guard.js'

const roots: string[] = []
const config: RepositoryHygieneGuardConfig = {
  forbiddenPathPatterns: [
    '(^|/)\\.env($|\\.)',
    '\\.(pem|key|p12)$',
    '(^|/)(dist|coverage|node_modules)/',
  ],
  allowedPathPatterns: ['(^|/)\\.env\\.example$', '(^|/)fixtures/'],
}

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-hygiene-'))
  roots.push(directory)
  return directory
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('repository hygiene guard', () => {
  it('matches normalized forbidden paths, applies exceptions, and sorts diagnostics', () => {
    expect(inspectTrackedPaths([
      'z\\dist\\bundle.js',
      'fixtures\\private.key',
      'config/.env.example',
      'área/private.pem',
      'config/.env.local',
    ], config)).toEqual([
      { filePath: 'config/.env.local', pattern: '(^|/)\\.env($|\\.)' },
      { filePath: 'z/dist/bundle.js', pattern: '(^|/)(dist|coverage|node_modules)/' },
      { filePath: 'área/private.pem', pattern: '\\.(pem|key|p12)$' },
    ])
  })

  it('validates regexes and rejects an empty direct inventory', async () => {
    expect(() => inspectTrackedPaths(['src/index.ts'], {
      ...config,
      forbiddenPathPatterns: ['['],
    })).toThrow('Invalid regular expression')

    await expect(runRepositoryHygieneGuard({
      config,
      trackedFiles: [],
    })).rejects.toThrow('must not be empty')
  })

  it('accepts a compliant inventory and reports all violations', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(await runRepositoryHygieneGuard({
      config,
      trackedFiles: ['src/index.ts', '.env.example'],
    })).toBe(0)
    expect(info).toHaveBeenCalledWith('Repository hygiene is valid (2 tracked files).')

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await runRepositoryHygieneGuard({
      config,
      trackedFiles: ['secret.key', '.env.production'],
    })).toBe(1)
    expect(error.mock.calls.flat().join('\n')).toContain('.env.production')
    expect(error.mock.calls.flat().join('\n')).toContain('secret.key')
  })

  it('reads NUL-delimited Git paths including spaces and Unicode', async () => {
    const directory = await tempRoot()
    spawnSync('git', ['init', '--quiet'], { cwd: directory, shell: false })
    await mkdir(path.join(directory, 'área'), { recursive: true })
    await writeFile(path.join(directory, 'área', 'with space.txt'), 'ok', 'utf8')
    spawnSync('git', ['add', '.'], { cwd: directory, shell: false })

    expect(readTrackedFiles(directory)).toEqual(['área/with space.txt'])
  })

  it('fails outside a Git worktree and for an empty tracked inventory', async () => {
    const outside = await tempRoot()
    expect(() => readTrackedFiles(outside)).toThrow('git ls-files failed')

    const empty = await tempRoot()
    spawnSync('git', ['init', '--quiet'], { cwd: empty, shell: false })
    expect(() => readTrackedFiles(empty)).toThrow('returned no tracked files')
  })

  it('reports process startup failures from Git', () => {
    vi.stubEnv('PATH', '')
    expect(() => readTrackedFiles('/')).toThrow('unable to list Git-tracked files')
    vi.unstubAllEnvs()
  })

  it('uses cwd and consumer configuration defaults independently', async () => {
    const directory = await tempRoot()
    await mkdir(path.join(directory, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(directory, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: { repositoryHygiene: config },
    }), 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await expect(runRepositoryHygieneGuard({
      rootDir: directory,
      trackedFiles: ['src/index.ts'],
    })).resolves.toBe(0)
    await expect(runRepositoryHygieneGuard({
      config,
      trackedFiles: ['src/index.ts'],
    })).resolves.toBe(0)

    spawnSync('git', ['init', '--quiet'], { cwd: directory, shell: false })
    await writeFile(path.join(directory, 'tracked.txt'), 'ok', 'utf8')
    spawnSync('git', ['add', '.'], { cwd: directory, shell: false })
    await expect(runRepositoryHygieneGuard({
      rootDir: directory,
      config,
    })).resolves.toBe(0)
  })
})
