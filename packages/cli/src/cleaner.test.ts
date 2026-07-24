import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig } from './config.js'
import { parseCleanArgs, parseLevel, resolvePackageManagerCommand, runCleaner } from './cleaner.js'

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-cli-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('clean command args', () => {
  it('parses levels and flags from long options', () => {
    expect(parseLevel('cache')).toBe('cache')
    expect(parseLevel('deep')).toBe('deep')
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

  it('falls back to default level when interactive mode is disabled and no level is chosen', async () => {
    const root = await createTempRoot()
    await runCleaner({ ...parseCleanArgs([]) }, { cwd: root, config: mergeConfig() })
    await expect(rm(root, { recursive: true, force: true })).resolves.toBeUndefined()
  })
})
