import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPnpmWorkspaceOverrides } from './pnpm-workspace-config.js'
import {
  collectLockfileVersions,
  collectWorkspacePackageJsonFiles,
  runSingletonDepsGuard,
  validateSingletonDependencyPolicy,
} from './singleton-deps-guard.js'

const roots: string[] = []

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-singleton-'))
  roots.push(directory)
  return directory
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('pnpm workspace override parsing', () => {
  it('reads quoted overrides and stops at the next root key', async () => {
    const directory = await root()
    const file = path.join(directory, 'pnpm-workspace.yaml')
    await writeFile(file, [
      'packages:',
      "  - 'packages/*'",
      'overrides:',
      "  'zod': '^4.0.0'",
      '  react: "19.0.0"',
      "  '': '^1.0.0'",
      "  empty: ''",
      'catalog:',
      '  ignored: 1',
    ].join('\n'), 'utf8')
    expect(readPnpmWorkspaceOverrides(file)).toEqual({ zod: '^4.0.0', react: '19.0.0' })
    expect(readPnpmWorkspaceOverrides(path.join(directory, 'missing.yaml'))).toEqual({})
  })
})

describe('singleton dependency validation', () => {
  it('extracts unique lockfile versions including peer suffixes', () => {
    expect(collectLockfileVersions([
      '  zod@4.1.0:',
      '  zod@4.1.0(typescript@6.0.0):',
      '  zod@4.2.0:',
    ].join('\n'), 'zod')).toEqual(['4.1.0', '4.2.0'])
  })

  it('reports invalid overrides, duplicate resolutions, and incompatible manifests', () => {
    const issues = validateSingletonDependencyPolicy({
      overrides: { zod: '^4.0.0', broken: 'not-semver' },
      lockfileContent: [
        '  zod@4.1.0:',
        '  zod@5.0.0:',
        '  broken@1.0.0:',
      ].join('\n'),
      manifests: [{
        filePath: 'package.json',
        manifest: { dependencies: { zod: '^3.0.0' } },
      }],
    })
    expect(issues.map((issue) => issue.message).join('\n')).toContain('semver/range valido')
    expect(issues.map((issue) => issue.message).join('\n')).toContain('multiplas versoes')
  })

  it('accepts one compatible resolved singleton', () => {
    expect(validateSingletonDependencyPolicy({
      overrides: { zod: '^4.0.0' },
      lockfileContent: '  zod@4.1.0:',
      manifests: [{
        filePath: 'package.json',
        manifest: { dependencies: { zod: '^4.0.0' } },
      }],
    })).toEqual([])
  })

  it('reports lockfile and manifest ranges that reject the resolved singleton', () => {
    const issues = validateSingletonDependencyPolicy({
      overrides: { zod: '^3.0.0' },
      lockfileContent: '  zod@4.1.0:',
      manifests: [{
        filePath: 'package.json',
        manifest: { dependencies: { zod: '^2.0.0' } },
      }],
    })
    expect(issues.map((issue) => issue.message).join('\n')).toContain('overrides exige compatibilidade')
    expect(issues.map((issue) => issue.message).join('\n')).toContain('deve aceitar a versao singleton')
  })
})

describe('singleton dependency guard runner', () => {
  it('discovers workspace manifests and accepts compatible policy', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'packages', 'core'), { recursive: true })
    await mkdir(path.join(directory, 'packages', 'ui'), { recursive: true })
    await mkdir(path.join(directory, 'packages', 'empty'), { recursive: true })
    await writeFile(path.join(directory, 'packages', 'README.md'), '', 'utf8')
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { zod: '^4.0.0' } }), 'utf8')
    await writeFile(path.join(directory, 'packages', 'core', 'package.json'), JSON.stringify({ peerDependencies: { zod: '^4.0.0' } }), 'utf8')
    await writeFile(path.join(directory, 'packages', 'ui', 'package.json'), JSON.stringify({ dependencies: { zod: '^4.0.0' } }), 'utf8')
    await writeFile(path.join(directory, 'pnpm-workspace.yaml'), "overrides:\n  zod: '^4.0.0'\n", 'utf8')
    await writeFile(path.join(directory, 'pnpm-lock.yaml'), '  zod@4.1.0:\n', 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(collectWorkspacePackageJsonFiles(directory)).toEqual([
      path.join(directory, 'packages', 'core', 'package.json'),
      path.join(directory, 'packages', 'ui', 'package.json'),
    ])
    expect(runSingletonDepsGuard(directory)).toBe(0)
  })

  it('handles absent lockfile content and empty normalized lockfile matches', () => {
    expect(validateSingletonDependencyPolicy({
      overrides: { zod: '^4.0.0' },
      manifests: [],
    })).toEqual([])
    expect(collectLockfileVersions('  zod@   :', 'zod')).toEqual([])
  })

  it('handles missing roots, absent overrides, and policy failures', async () => {
    const missing = await root()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(runSingletonDepsGuard(missing)).toBe(1)

    const skipped = await root()
    await writeFile(path.join(skipped, 'package.json'), '{}', 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(runSingletonDepsGuard(skipped)).toBe(0)

    const failed = await root()
    await writeFile(path.join(failed, 'package.json'), '{}', 'utf8')
    await writeFile(path.join(failed, 'pnpm-workspace.yaml'), "overrides:\n  zod: '^4.0.0'\n  react: '^19.0.0'\n", 'utf8')
    expect(runSingletonDepsGuard(failed)).toBe(1)
  })
})
