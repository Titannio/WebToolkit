import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig, findConfigPath, loadConfig, pathExists } from './config.js'

afterEach(async () => {
  vi.restoreAllMocks()
})

describe('config file discovery', () => {
  it('loads defaults when no config exists', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-config-'))
    const { config, configPath } = await loadConfig(temp)

    expect(configPath).toBeNull()
    expect(config.packageManager).toBe('pnpm')
    expect(config.cleaner.levels.cache.label).toContain('temp')

    await rm(temp, { recursive: true, force: true })
  })

  it('finds the closest .webtoolkit-cli/config.json up the directory tree', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-config-'))
    const nested = path.join(root, 'apps', 'api')
    await mkdir(path.join(root, '.webtoolkit-cli'), { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(root, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      packageManager: 'pnpm',
      workspaceTests: {
        workspaces: [],
      },
    }), 'utf8')

    const { config, configPath } = await loadConfig(nested)
    expect(configPath).toBe(path.join(root, '.webtoolkit-cli', 'config.json'))
    expect(config.packageManager).toBe('pnpm')
    expect(config.workspaceTests).toBeDefined()

    await rm(root, { recursive: true, force: true })
  })
})

describe('config merging', () => {
  it('merges cleaner overrides while preserving defaults', () => {
    const config = mergeConfig({
      documentation: {
        files: ['docs/**/*.md'],
      },
      cleaner: {
        levels: {
          cache: {
            removableDirNames: ['cacheOnly'],
            removableFileNames: ['custom-cache.txt'],
            removableFilePatterns: ['\\.tmp$'],
          },
        },
      } as never,
    })

    expect(config.packageManager).toBe('pnpm')
    expect(config.documentation?.files).toEqual(['docs/**/*.md'])
    expect(config.cleaner.levels.cache.removableDirNames).toContain('cacheOnly')
    expect(config.cleaner.levels.cache.removableDirNames).not.toContain('.turbo')
    expect(config.cleaner.levels.cache.removableFileNames).toContain('custom-cache.txt')
    expect(config.cleaner.levels.cache.removableFilePatterns).toContain('\\.tmp$')
  })

  it('returns boolean status for config path existence', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-config-'))
    const candidate = path.join(temp, 'present.txt')
    await writeFile(candidate, 'ok', 'utf8')

    await expect(pathExists(candidate)).resolves.toBe(true)
    await expect(pathExists(path.join(temp, 'missing.txt'))).resolves.toBe(false)

    await rm(temp, { recursive: true, force: true })
  })
})

it('exposes the workspace root of a matching config path', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-config-'))
  const cwd = path.join(temp, 'a', 'b')
  await mkdir(cwd, { recursive: true })
  const configFile = path.join(temp, '.webtoolkit-cli', 'config.json')

  await mkdir(path.dirname(configFile), { recursive: true })
  await writeFile(configFile, JSON.stringify({}), 'utf8')

  expect(await findConfigPath(cwd)).toBe(configFile)

  await rm(temp, { recursive: true, force: true })
})
