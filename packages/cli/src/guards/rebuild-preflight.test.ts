import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  extractPackagesNeedingRebuild,
  formatRebuildPreflightWarning,
  getRebuildPreflightReport,
  getTargetDefinition,
  parseTurboDryRun,
  printRebuildPreflightWarning,
} from './rebuild-preflight.js'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('resolves consumer-configured targets without builtin project names', () => {
  const targets = {
    api: {
      warningTitle: 'Rebuild recommended before starting API',
      turboFilters: ['@example/api'],
      relevantBuildPackages: ['@example/contracts'],
    },
  }

  expect(getTargetDefinition('api', targets)).toEqual(targets.api)
  expect(() => getTargetDefinition('missing', targets)).toThrow('Expected one of api')
})

describe('rebuild preflight reports', () => {
  it('parses Turbo output and selects relevant cache misses', () => {
    expect(() => parseTurboDryRun('')).toThrow('no JSON output')
    expect(() => parseTurboDryRun('{')).toThrow()
    expect(extractPackagesNeedingRebuild({
      tasks: [
        { task: 'lint', command: 'eslint', package: '@acme/ignored' },
        { task: 'build', command: '<NONEXISTENT>', package: '@acme/missing' },
        { task: 'build', command: 'tsc', package: '@acme/hit', cache: { status: 'HIT' } },
        { task: 'build', command: 'tsc', package: '@acme/miss', cache: { status: 'MISS' } },
      ],
    }, ['@acme/miss'])).toEqual(['@acme/miss'])
  })

  it('formats warnings only when rebuilds are needed', () => {
    expect(formatRebuildPreflightWarning({
      target: 'api',
      warningTitle: 'Rebuild required',
      packagesNeedingRebuild: [],
    })).toBe('')
    expect(formatRebuildPreflightWarning({
      target: 'api',
      warningTitle: 'Rebuild required',
      packagesNeedingRebuild: ['@acme/core'],
    })).toContain('@acme/core')
  })

  it('loads configured targets, skips empty policies, and prints cache misses', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-rebuild-'))
    roots.push(root)
    await mkdir(path.join(root, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(root, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      packageManager: 'npm',
      guards: {
        rebuildPreflight: {
          targets: {
            empty: {
              warningTitle: 'Nothing to rebuild',
              turboFilters: ['@acme/app'],
              relevantBuildPackages: [],
            },
            api: {
              warningTitle: 'Rebuild API',
              turboFilters: ['@acme/api'],
              relevantBuildPackages: ['@acme/core'],
            },
          },
        },
      },
    }), 'utf8')

    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(await printRebuildPreflightWarning({ repoRoot: root, target: 'empty' })).toEqual({
      target: 'empty',
      warningTitle: 'Nothing to rebuild',
      packagesNeedingRebuild: [],
    })
    expect(spawnSync).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()

    vi.mocked(spawnSync).mockReturnValue({
      pid: 1,
      output: [],
      stdout: JSON.stringify({
        tasks: [{ task: 'build', command: 'tsc', package: '@acme/core', cache: { status: 'MISS' } }],
      }),
      stderr: '',
      status: 0,
      signal: null,
    })
    expect(await printRebuildPreflightWarning({ repoRoot: root, target: 'api' })).toMatchObject({
      packagesNeedingRebuild: ['@acme/core'],
    })
    expect(write).toHaveBeenCalledWith(expect.stringContaining('@acme/core'))
  })

  it('reports missing configuration and Turbo failures', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-rebuild-'))
    roots.push(root)
    await expect(getRebuildPreflightReport({ repoRoot: root, target: 'api' })).rejects.toThrow('not configured')

    await mkdir(path.join(root, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(root, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: {
        rebuildPreflight: {
          targets: {
            api: {
              warningTitle: 'Rebuild API',
              turboFilters: ['filter with spaces'],
              relevantBuildPackages: ['@acme/core'],
            },
          },
        },
      },
    }), 'utf8')
    vi.mocked(spawnSync).mockReturnValue({
      pid: 1,
      output: [],
      stdout: '',
      stderr: 'failed',
      status: 1,
      signal: null,
    })
    await expect(getRebuildPreflightReport({ repoRoot: root, target: 'api' })).rejects.toThrow('Turbo dry run failed')

    vi.mocked(spawnSync).mockReturnValue({
      pid: 1,
      output: [],
      stdout: 'stdout failed',
      stderr: '',
      status: 1,
      signal: null,
    })
    await expect(getRebuildPreflightReport({ repoRoot: root, target: 'api' })).rejects.toThrow('stdout failed')

    vi.mocked(spawnSync).mockReturnValue({
      pid: 1,
      output: [],
      stdout: '',
      stderr: '',
      status: 7,
      signal: null,
    })
    await expect(getRebuildPreflightReport({ repoRoot: root, target: 'api' })).rejects.toThrow('exit code 7')

    vi.mocked(spawnSync).mockReturnValue({
      pid: 1,
      output: [],
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: new Error('spawn failed'),
    })
    await expect(getRebuildPreflightReport({ repoRoot: root, target: 'api' })).rejects.toThrow('spawn failed')

    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.mocked(spawnSync).mockReturnValue({
      pid: 1,
      output: [],
      stdout: JSON.stringify({ tasks: [] }),
      stderr: '',
      status: 0,
      signal: null,
    })
    await expect(getRebuildPreflightReport({ repoRoot: root, target: 'api' })).resolves.toMatchObject({
      packagesNeedingRebuild: [],
    })
  })

  it('falls back to cmd.exe when ComSpec is unavailable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-rebuild-'))
    roots.push(root)
    await mkdir(path.join(root, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(root, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: {
        rebuildPreflight: {
          targets: {
            api: {
              warningTitle: 'Rebuild API',
              turboFilters: ['@acme/api'],
              relevantBuildPackages: ['@acme/core'],
            },
          },
        },
      },
    }), 'utf8')
    const comSpec = process.env.ComSpec
    delete process.env.ComSpec
    vi.mocked(spawnSync).mockReturnValue({
      pid: 1,
      output: [],
      stdout: JSON.stringify({ tasks: [] }),
      stderr: '',
      status: 0,
      signal: null,
    })

    try {
      await expect(getRebuildPreflightReport({ repoRoot: root, target: 'api' })).resolves.toBeDefined()
    } finally {
      if (comSpec !== undefined) process.env.ComSpec = comSpec
    }
  })
})
