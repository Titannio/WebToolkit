import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PackageSurfaceGuardConfig } from '../config.js'
import type { PackCommandResult } from './package-surface-guard.js'
import {
  collectManifestTargets,
  readPackedFiles,
  runPackageSurfaceGuard,
} from './package-surface-guard.js'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-package-surface-'))
  roots.push(directory)
  return directory
}

async function writePackage(
  root: string,
  packageDirectory: string,
  manifest: object | string,
  files: string[] = [],
): Promise<void> {
  const absoluteDirectory = path.join(root, packageDirectory)
  await mkdir(absoluteDirectory, { recursive: true })
  await writeFile(
    path.join(absoluteDirectory, 'package.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    'utf8',
  )
  for (const file of files) {
    const target = path.join(absoluteDirectory, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, 'export {}\n', 'utf8')
  }
}

function packResult(files: string[]): PackCommandResult {
  return {
    status: 0,
    stderr: '',
    stdout: JSON.stringify([{ files: files.map((file) => ({ path: file })) }]),
  }
}

function config(packageDirectories = ['packages/example']): PackageSurfaceGuardConfig {
  return {
    packageDirectories,
    forbiddenPublishedPatterns: ['(^|/)__tests__/', '\\.(test|spec)\\.'],
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('package surface guard', () => {
  it('collects scalar, string/object bin, nested export, array, and null targets', () => {
    expect(collectManifestTargets('packages/example', {
      main: './dist/index.js',
      module: './dist/module.js',
      types: './dist/index.d.ts',
      typings: './dist/legacy.d.ts',
      bin: { tool: './dist/bin.js' },
      exports: {
        '.': {
          types: './dist/index.d.ts',
          import: ['./dist/index.js', null],
        },
        './package.json': './package.json',
      },
    })).toEqual({
      issues: [],
      targets: [
        { field: 'main', target: './dist/index.js' },
        { field: 'module', target: './dist/module.js' },
        { field: 'types', target: './dist/index.d.ts' },
        { field: 'typings', target: './dist/legacy.d.ts' },
        { field: 'bin.tool', target: './dist/bin.js' },
        { field: 'exports["."].types', target: './dist/index.d.ts' },
        { field: 'exports["."].import[0]', target: './dist/index.js' },
        { field: 'exports["./package.json"]', target: './package.json' },
      ],
    })

    expect(collectManifestTargets('packages/example', { bin: './dist/bin.js' }).targets)
      .toEqual([{ field: 'bin', target: './dist/bin.js' }])
    expect(collectManifestTargets('packages/example', { bin: [], exports: false }).issues)
      .toHaveLength(2)
  })

  it('accepts valid public targets across multiple packages', async () => {
    const root = await tempRoot()
    await writePackage(root, 'packages/one', {
      main: './dist/index.js',
      types: './dist/index.d.ts',
    }, ['dist/index.js', 'dist/index.d.ts'])
    await writePackage(root, 'packages/two', {
      bin: './dist/bin.js',
      exports: { '.': { import: './dist/index.js', default: null } },
    }, ['dist/bin.js', 'dist/index.js'])
    const packed = new Map([
      ['one', packResult(['package.json', 'dist/index.js', 'dist/index.d.ts'])],
      ['two', packResult(['package.json', 'dist/bin.js', 'dist/index.js'])],
    ])
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(await runPackageSurfaceGuard({
      rootDir: root,
      config: config(['packages/one', 'packages/two']),
      runPack: (directory) => packed.get(path.basename(directory))!,
    })).toBe(0)
  })

  it('reports missing, excluded, and forbidden files in deterministic order', async () => {
    const root = await tempRoot()
    await writePackage(root, 'packages/example', {
      main: './dist/missing.js',
      types: './dist/index.d.ts',
    }, ['dist/index.d.ts'])
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await runPackageSurfaceGuard({
      rootDir: root,
      config: config(),
      runPack: () => packResult([
        'src/example.test.js',
        'package.json',
        'dist/missing.js',
      ]),
    })).toBe(1)
    const output = error.mock.calls.flat().join('\n')
    expect(output).toContain('public target is missing after build')
    expect(output).toContain('dist/index.d.ts: public target is excluded')
    expect(output).toContain('src/example.test.js: matches forbidden pattern')
  })

  it('diagnoses wildcard, escaping, external, and invalid manifest targets', async () => {
    const root = await tempRoot()
    await writePackage(root, 'packages/example', {
      main: 42,
      module: '../outside.js',
      bin: { tool: false },
      exports: {
        './wild/*': './dist/*.js',
        './escape': '../outside.js',
        './external': 'external-package',
      },
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await runPackageSurfaceGuard({
      rootDir: root,
      config: config(),
      runPack: () => packResult(['package.json']),
    })).toBe(1)
    const output = error.mock.calls.flat().join('\n')
    expect(output).toContain('wildcard manifest targets are unsupported')
    expect(output).toContain('Guard path must stay inside the project')
    expect(output).toContain('export target must start with ./')
    expect(output).toContain('[main]')
    expect(output).toContain('[bin.tool]')
  })

  it('reads npm 12 package-keyed pack output', () => {
    expect(readPackedFiles('packages/example', () => ({
      status: 0,
      stdout: JSON.stringify({
        example: { files: [{ path: 'dist/index.js' }] },
      }),
      stderr: '',
    }))).toEqual(['dist/index.js'])
  })

  it('rejects malformed npm output and npm command failures', async () => {
    expect(() => readPackedFiles('packages/example', () => ({
      status: 0,
      stdout: 'not json',
      stderr: '',
    }))).toThrow('invalid npm pack JSON')

    expect(() => readPackedFiles('packages/example', () => ({
      status: 1,
      stdout: '',
      stderr: 'pack failed',
    }))).toThrow('pack failed')
    expect(() => readPackedFiles('packages/example', () => ({
      status: 1,
      stdout: '',
      stderr: '',
    }))).toThrow('npm pack failed')

    expect(() => readPackedFiles('packages/example', () => ({
      error: new Error('spawn failed'),
      status: null,
      stdout: '',
      stderr: '',
    }))).toThrow('spawn failed')

    expect(() => readPackedFiles('packages/example', () => ({
      status: 0,
      stdout: JSON.stringify([{ files: [{ size: 1 }] }]),
      stderr: '',
    }))).toThrow('invalid files list')
    expect(() => readPackedFiles('packages/example', () => ({
      status: 0,
      stdout: '[]',
      stderr: '',
    }))).toThrow('must contain one package')
    expect(() => readPackedFiles('packages/example', () => ({
      status: 0,
      stdout: 'null',
      stderr: '',
    }))).toThrow('must contain one package')
  })

  it('rejects escaping, missing, and malformed package directories', async () => {
    const root = await tempRoot()
    await expect(runPackageSurfaceGuard({
      rootDir: root,
      config: config(['../outside']),
      runPack: () => packResult([]),
    })).rejects.toThrow('Guard path must stay inside the project')

    await expect(runPackageSurfaceGuard({
      rootDir: root,
      config: config(['packages/missing']),
      runPack: () => packResult([]),
    })).rejects.toThrow('missing package directory')

    await mkdir(path.join(root, 'packages', 'no-manifest'), { recursive: true })
    await expect(runPackageSurfaceGuard({
      rootDir: root,
      config: config(['packages/no-manifest']),
      runPack: () => packResult([]),
    })).rejects.toThrow('package.json is missing')

    await writePackage(root, 'packages/malformed', '{')
    await expect(runPackageSurfaceGuard({
      rootDir: root,
      config: config(['packages/malformed']),
      runPack: () => packResult([]),
    })).rejects.toThrow('invalid packages/malformed/package.json')

    await writePackage(root, 'packages/non-object', 'null')
    await expect(runPackageSurfaceGuard({
      rootDir: root,
      config: config(['packages/non-object']),
      runPack: () => packResult([]),
    })).rejects.toThrow('must contain an object')
  })

  it('runs a real offline npm dry-run without leaving a tarball', async () => {
    const root = await tempRoot()
    await writePackage(root, 'package', {
      name: 'webtoolkit-package-surface-fixture',
      version: '1.0.0',
      main: './dist/index.js',
      files: ['dist'],
    }, ['dist/index.js'])
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(await runPackageSurfaceGuard({
      rootDir: root,
      config: {
        packageDirectories: ['package'],
        forbiddenPublishedPatterns: [],
      },
    })).toBe(0)
    expect((await readdir(path.join(root, 'package'))).some((file) => file.endsWith('.tgz'))).toBe(false)
  }, 20_000)

  it('loads consumer policy when config is omitted and uses cwd when root is omitted', async () => {
    const root = await tempRoot()
    await writePackage(root, 'packages/example', { main: './dist/index.js' }, ['dist/index.js'])
    await mkdir(path.join(root, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(root, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: { packageSurface: config() },
    }), 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await expect(runPackageSurfaceGuard({
      rootDir: root,
      runPack: () => packResult(['dist/index.js']),
    })).resolves.toBe(0)
    await expect(runPackageSurfaceGuard({
      config: config(['missing']),
      runPack: () => packResult([]),
    })).rejects.toThrow('missing package directory')
  })
})
