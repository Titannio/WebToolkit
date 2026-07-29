import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceManifestGuardConfig } from '../config.js'
import { runWorkspaceManifestGuard } from './workspace-manifest-guard.js'

const roots: string[] = []
const config: WorkspaceManifestGuardConfig = {
  packageRoots: ['apps', 'packages'],
  requireWorkspaceProtocol: true,
  peerRequirements: [{
    dependency: 'react',
    providers: ['packages/shared-ui'],
    consumers: ['apps/web'],
  }],
}

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-workspace-'))
  roots.push(directory)
  await mkdir(path.join(directory, 'apps'), { recursive: true })
  await mkdir(path.join(directory, 'packages'), { recursive: true })
  return directory
}

async function manifest(directory: string, packagePath: string, contents: object | string): Promise<void> {
  const packageDirectory = path.join(directory, packagePath)
  await mkdir(packageDirectory, { recursive: true })
  await writeFile(
    path.join(packageDirectory, 'package.json'),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
    'utf8',
  )
}

async function compliantWorkspace(): Promise<string> {
  const directory = await root()
  await manifest(directory, 'packages/core', { name: '@acme/core' })
  await manifest(directory, 'packages/shared-ui', {
    name: '@acme/shared-ui',
    peerDependencies: { react: '^19.0.0' },
    devDependencies: {
      '@acme/core': 'workspace:*',
      react: '^19.0.0',
    },
  })
  await manifest(directory, 'apps/web', {
    name: '@acme/web',
    dependencies: {
      '@acme/shared-ui': 'workspace:*',
      react: '^19.0.0',
    },
  })
  return directory
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('workspace manifest guard', () => {
  it('accepts a compliant multi-package workspace and peer-plus-dev provider setup', async () => {
    const directory = await compliantWorkspace()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(await runWorkspaceManifestGuard({ rootDir: directory, config })).toBe(0)
  })

  it('reports missing and duplicate workspace package names', async () => {
    const directory = await root()
    await manifest(directory, 'apps/unnamed', { private: true })
    await manifest(directory, 'apps/first', { name: '@acme/duplicate' })
    await manifest(directory, 'packages/second', { name: '@acme/duplicate' })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await runWorkspaceManifestGuard({
      rootDir: directory,
      config: { ...config, peerRequirements: [] },
    })).toBe(1)
    const output = error.mock.calls.flat().join('\n')
    expect(output).toContain('name is required')
    expect(output).toContain('duplicates workspace package name')
  })

  it('enforces internal workspace protocols, version ranges, and exclusive runtime sections', async () => {
    const directory = await root()
    await manifest(directory, 'packages/core', { name: '@acme/core' })
    await manifest(directory, 'apps/web', {
      name: '@acme/web',
      dependencies: {
        '@acme/core': '^1.0.0',
        tag: 'latest',
        react: '^19.0.0',
      },
      peerDependencies: {
        broken: 'not a range',
        invalidWorkspace: 'workspace:not-a-range',
        react: '^19.0.0',
      },
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await runWorkspaceManifestGuard({
      rootDir: directory,
      config: { ...config, peerRequirements: [] },
    })).toBe(1)
    const output = error.mock.calls.flat().join('\n')
    expect(output).toContain('workspace: protocol')
    expect(output).toContain('invalid version range')
    expect(output).toContain('conflicting runtime sections')
  })

  it('enforces provider and consumer peer placement', async () => {
    const directory = await root()
    await manifest(directory, 'packages/shared-ui', {
      name: '@acme/shared-ui',
      dependencies: { react: '^19.0.0' },
    })
    await manifest(directory, 'apps/web', {
      name: '@acme/web',
      devDependencies: { react: '^19.0.0' },
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await runWorkspaceManifestGuard({ rootDir: directory, config })).toBe(1)
    const output = error.mock.calls.flat().join('\n')
    expect(output).toContain('peerDependencies for this provider')
    expect(output).toContain('provider runtime dependencies')
    expect(output).toContain('runtime dependency section for this consumer')
  })

  it('rejects invalid package roots and peer package paths', async () => {
    const missingRoot = await root()
    await expect(runWorkspaceManifestGuard({
      rootDir: missingRoot,
      config: { ...config, packageRoots: ['missing'] },
    })).rejects.toThrow('missing directory')

    const emptyRoot = await root()
    await expect(runWorkspaceManifestGuard({
      rootDir: emptyRoot,
      config: { ...config, peerRequirements: [] },
    })).rejects.toThrow('zero eligible files')

    const invalidPeerRoot = await compliantWorkspace()
    await expect(runWorkspaceManifestGuard({
      rootDir: invalidPeerRoot,
      config: {
        ...config,
        peerRequirements: [{
          ...config.peerRequirements[0],
          providers: ['packages/missing'],
        }],
      },
    })).rejects.toThrow('peerRequirements[0].providers[0]')
  })

  it('rejects malformed manifests and empty direct-call configuration', async () => {
    const directory = await root()
    await manifest(directory, 'apps/web', '{')
    await expect(runWorkspaceManifestGuard({
      rootDir: directory,
      config: { ...config, peerRequirements: [] },
    })).rejects.toThrow('invalid package.json')

    await expect(runWorkspaceManifestGuard({
      rootDir: directory,
      config: { ...config, packageRoots: [] },
    })).rejects.toThrow('must not be empty')

    const nonObject = await root()
    await manifest(nonObject, 'apps/null', 'null')
    await expect(runWorkspaceManifestGuard({
      rootDir: nonObject,
      config: { ...config, packageRoots: ['apps'], peerRequirements: [] },
    })).rejects.toThrow('must contain an object')
  })

  it('ignores non-package entries and accepts every workspace protocol shorthand', async () => {
    const directory = await root()
    await writeFile(path.join(directory, 'apps', 'README.md'), '', 'utf8')
    await mkdir(path.join(directory, 'apps', 'empty'), { recursive: true })
    await manifest(directory, 'apps/web', {
      name: '@acme/web',
      dependencies: {
        first: 'workspace:*',
        second: 'workspace:^',
        third: 'workspace:~',
        fourth: 'workspace:^1.2.3',
      },
    })
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')

    expect(await runWorkspaceManifestGuard({
      rootDir: directory,
      config: { packageRoots: ['apps'], requireWorkspaceProtocol: true, peerRequirements: [] },
    })).toBe(0)

    platform.mockReturnValue('win32')
    expect(await runWorkspaceManifestGuard({
      rootDir: directory,
      config: { packageRoots: ['apps'], requireWorkspaceProtocol: true, peerRequirements: [] },
    })).toBe(0)
  })

  it('loads consumer policy when config is omitted and uses cwd when root is omitted', async () => {
    const directory = await root()
    await manifest(directory, 'apps/web', { name: '@acme/web' })
    await mkdir(path.join(directory, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(directory, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: {
        workspaceManifest: {
          packageRoots: ['apps'],
          requireWorkspaceProtocol: true,
          peerRequirements: [],
        },
      },
    }), 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await expect(runWorkspaceManifestGuard({ rootDir: directory })).resolves.toBe(0)
    await expect(runWorkspaceManifestGuard({
      config: { packageRoots: ['missing'], requireWorkspaceProtocol: true, peerRequirements: [] },
    })).rejects.toThrow('missing directory')
  })
})
