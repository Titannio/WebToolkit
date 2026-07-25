import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildArchitectureMapModel,
  initialGraphExpansion,
  renderArchitectureMap,
  runArchitectureMap,
} from './architecture-map.js'
import { mergeConfig } from './config.js'

const temporaryDirectories: string[] = []

function createRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'webtoolkit-architecture-map-test-'))
  temporaryDirectories.push(root)
  mkdirSync(path.join(root, 'apps', 'web', 'src'), { recursive: true })
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  writeFileSync(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@acme/web' }))
  return root
}

const cruiseResult = {
  modules: [
    {
      source: 'apps/web/src/main.ts',
      valid: false,
      rules: [{ name: 'module-rule', severity: 'warn' }],
      dependencies: [
        {
          module: './feature.js',
          resolved: 'apps/web/src/feature.ts',
          circular: true,
          valid: false,
          rules: [{ name: 'no-cycle', severity: 'error' }],
        },
        {
          module: 'react',
          resolved: 'node_modules/react/index.js',
          circular: false,
          valid: true,
        },
      ],
    },
    {
      source: 'apps/web/src/feature.ts',
      dependencies: [],
    },
    {
      source: 'scripts/check.ts',
      dependencies: [{
        module: 'missing-package',
        resolved: 'missing-package',
        couldNotResolve: true,
      }],
    },
    {
      source: 'outside/ignored.ts',
      dependencies: [],
    },
  ],
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

describe('architecture map', () => {
  it('builds package hierarchy and dependency details for configured paths', () => {
    const root = createRoot()
    const model = buildArchitectureMapModel(cruiseResult, root, ['apps', 'scripts'], '2026-07-25T12:00:00.000Z')
    const main = model.nodes['file:apps/web/src/main.ts']
    const feature = model.nodes['file:apps/web/src/feature.ts']

    expect(model.nodes['directory:apps/web']).toMatchObject({
      kind: 'package',
      name: '@acme/web',
      fileCount: 2,
    })
    expect(main).toMatchObject({
      imports: ['file:apps/web/src/feature.ts'],
      externalImports: ['react'],
      circular: true,
      violations: ['error: no-cycle', 'warn: module-rule'],
    })
    expect(feature.importedBy).toEqual(['file:apps/web/src/main.ts'])
    expect(model.summary).toEqual({
      files: 3,
      dependencies: 3,
      externalDependencies: 2,
      violations: 2,
    })
    expect(model.nodes['file:outside/ignored.ts']).toBeUndefined()

    mkdirSync(path.join(root, 'packages', 'empty', 'src'), { recursive: true })
    mkdirSync(path.join(root, 'packages', 'broken', 'src'), { recursive: true })
    writeFileSync(path.join(root, 'packages', 'empty', 'package.json'), JSON.stringify({ name: '' }))
    writeFileSync(path.join(root, 'packages', 'broken', 'package.json'), '{')
    const unusualPackages = buildArchitectureMapModel({
      modules: [
        {
          source: 'packages/empty/src/a.ts',
          rules: [{ name: 'plain-rule' }],
          dependencies: [],
        },
        {
          source: 'packages/broken/src/b.ts',
          dependencies: [],
        },
      ],
    }, root, ['packages'])
    expect(unusualPackages.nodes['directory:packages/empty'].kind).toBe('directory')
    expect(unusualPackages.nodes['directory:packages/broken'].kind).toBe('directory')
    expect(unusualPackages.nodes['file:packages/empty/src/a.ts'].violations).toEqual(['plain-rule'])
  })

  it('renders one self-contained HTML document with safely embedded data', () => {
    const root = createRoot()
    const model = buildArchitectureMapModel(cruiseResult, root, ['apps', 'scripts'])
    model.nodes[model.rootId].name = '</script><script>alert(1)</script>'
    const html = renderArchitectureMap(model)

    expect(initialGraphExpansion(model, 0)).toEqual(['repository:.'])
    expect(initialGraphExpansion(model, 1)).toEqual([
      'repository:.',
      'directory:apps',
    ])
    expect(initialGraphExpansion(model)).toEqual([
      'repository:.',
      'directory:apps',
    ])
    expect(initialGraphExpansion(model, 2)).toEqual([
      'repository:.',
      'directory:apps',
      'directory:apps/web',
    ])
    expect(initialGraphExpansion(model, 3)).toEqual([
      'repository:.',
      'directory:apps',
      'directory:apps/web',
      'directory:apps/web/src',
    ])
    expect(initialGraphExpansion(model, 4)).toEqual(initialGraphExpansion(model, 3))
    expect(html).toContain('<style>')
    expect(html).toContain('id="architecture-data"')
    expect(html).toContain('id="architecture-graph"')
    expect(html).toContain('id="fit-graph"')
    expect(html).toContain('aggregateDependencies')
    expect(html).toContain('visibleHierarchy')
    expect(html).toContain('dependency-out')
    expect(html).not.toContain('id="tree"')
    expect(html).not.toContain('</script><script>alert(1)</script>')
    expect(html).toContain('\\u003c/script\\u003e')
    expect(html).not.toContain('src="http')
  })

  it('runs dependency-cruiser and writes the configured dated output', () => {
    const root = createRoot()
    const outputDirectory = path.join(root, 'generated')
    writeFileSync(path.join(root, 'dependency-cruiser.cjs'), 'module.exports = {}')
    const spawn = vi.fn((_command, args: readonly string[]) => {
      const outputIndex = args.indexOf('--output-to')
      writeFileSync(String(args[outputIndex + 1]), JSON.stringify(cruiseResult))
      return { status: 0, error: undefined }
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const config = mergeConfig({
      architectureMap: {
        includePaths: ['apps', 'scripts'],
        outputDirectory,
        dependencyCruiserConfig: 'dependency-cruiser.cjs',
        initialExpandedDepth: 1,
      },
      tasks: {},
    })

    const outputPath = runArchitectureMap({ cwd: root, config }, {
      now: new Date(2026, 6, 25, 12),
      resolveBin: () => '/dependency-cruiser.mjs',
      spawn: spawn as unknown as typeof import('node:child_process').spawnSync,
    })

    expect(outputPath).toBe(path.join(outputDirectory, '2026-07-25_architecture-map.html'))
    expect(readFileSync(outputPath, 'utf8')).toContain('Architecture map')
    expect(readFileSync(outputPath, 'utf8')).toContain(
      '"initialExpanded":["repository:.","directory:apps"]',
    )
    expect(spawn).toHaveBeenCalledWith(process.execPath, expect.arrayContaining([
      '/dependency-cruiser.mjs',
      'apps',
      'scripts',
      '--config',
      'dependency-cruiser.cjs',
      '--output-type',
      'json',
    ]), expect.objectContaining({ cwd: root, stdio: 'inherit' }))
    expect(info).toHaveBeenCalledWith(expect.stringContaining('3 files'))
  })

  it('uses runtime defaults with the installed analyzer and a relative output directory', () => {
    const root = createRoot()
    mkdirSync(path.join(root, 'src'))
    writeFileSync(path.join(root, 'src', 'index.ts'), 'export const value = 1\n')
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const config = mergeConfig({
      architectureMap: {
        includePaths: ['src'],
        outputDirectory: 'generated',
      },
      tasks: {},
    })

    const outputPath = runArchitectureMap({ cwd: root, config })

    expect(path.dirname(outputPath)).toBe(path.join(root, 'generated'))
    expect(path.basename(outputPath)).toMatch(/^\d{4}-\d{2}-\d{2}_architecture-map\.html$/u)
    expect(readFileSync(outputPath, 'utf8')).toContain('file:src/index.ts')
    expect(info).toHaveBeenCalled()
  })

  it('fails clearly for invalid configuration and analyzer results', () => {
    const root = createRoot()
    const noConfig = mergeConfig({ tasks: {} })
    expect(() => runArchitectureMap({ cwd: root, config: noConfig })).toThrow('architectureMap is not configured')

    const configFor = (overrides: Partial<NonNullable<ReturnType<typeof mergeConfig>['architectureMap']>> = {}) => (
      mergeConfig({
        architectureMap: {
          includePaths: ['apps'],
          outputDirectory: path.join(root, 'generated'),
          ...overrides,
        },
        tasks: {},
      })
    )
    expect(() => runArchitectureMap({
      cwd: root,
      config: configFor({ includePaths: ['missing'] }),
    })).toThrow('does not exist')

    writeFileSync(path.join(root, 'not-a-directory.ts'), '')
    expect(() => runArchitectureMap({
      cwd: root,
      config: configFor({ includePaths: ['not-a-directory.ts'] }),
    })).toThrow('is not a directory')

    expect(() => runArchitectureMap({
      cwd: root,
      config: configFor({ dependencyCruiserConfig: 'missing.cjs' }),
    })).toThrow('dependencyCruiserConfig does not exist')

    const runWithSpawn = (result: { status: number | null; error?: Error }, output?: unknown) => (
      runArchitectureMap({ cwd: root, config: configFor() }, {
        resolveBin: () => '/dependency-cruiser.mjs',
        spawn: vi.fn((_command, args: readonly string[]) => {
          if (output !== undefined) {
            const outputIndex = args.indexOf('--output-to')
            writeFileSync(String(args[outputIndex + 1]), JSON.stringify(output))
          }
          return result
        }) as unknown as typeof import('node:child_process').spawnSync,
      })
    )

    expect(() => runWithSpawn({ status: null, error: new Error('spawn failed') })).toThrow('spawn failed')
    expect(() => runWithSpawn({ status: 2 })).toThrow('exit code 2')
    expect(() => runWithSpawn({ status: null })).toThrow('exit code 1')
    expect(() => runWithSpawn({ status: 0 }, {})).toThrow('invalid JSON result')
  })
})
