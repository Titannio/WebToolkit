import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig } from './config.js'
import { parseCleanArgs, resolvePackageManagerCommand, runCleaner } from './cleaner.js'

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
  it('parses nuclear mode with no-store-prune and reinstall policy', () => {
    const options = parseCleanArgs(['--level=nuclear', '--no-store-prune', '--reinstall=never'])

    expect(options).toEqual({
      level: 'nuclear',
      dryRun: false,
      noStorePrune: true,
      interactive: false,
      reinstall: 'never',
    })
  })

  it('ignores a package-script argument separator', () => {
    expect(parseCleanArgs(['--', '--level', 'cache', '--dry-run'])).toEqual({
      level: 'cache',
      dryRun: true,
      noStorePrune: false,
      interactive: false,
      reinstall: 'ask',
    })
  })

  it('wraps the package manager through cmd.exe on Windows', () => {
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

  it('calls the package manager directly outside Windows', () => {
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

  it('removes project-specific files from config overrides', async () => {
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

    expect(removals).toContainEqual({ kind: 'file', relPath: path.join('apps', 'frontend-user', 'src', 'setup-env.js') })
    await expect(readFile(generatedFile, 'utf8')).rejects.toThrow()
  })
})
