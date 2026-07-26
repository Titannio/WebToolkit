import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  configSchema,
  configSectionNames,
  formatConfigHelp,
  getConfigSchema,
  runConfigReference,
  validateConfig,
} from './config-reference.js'

describe('config reference', () => {
  it('exposes every public config section', () => {
    expect(configSectionNames()).toEqual([
      'packageManager',
      'cleaner',
      'tasks',
      'architectureMap',
      'guards',
      'documentation',
      'workspaceTests',
      'repoCheck',
      'releaseGate',
      'validate',
      'jsdocReport',
      'bundleAudit',
      'upgrade',
      'devWatch',
      'devGrid',
      'environment',
    ])
    expect(getConfigSchema()).toBe(configSchema)
  })

  it('renders general and section-specific human help', () => {
    expect(formatConfigHelp()).toContain('webtoolkit config --help <section>')
    expect(formatConfigHelp()).toContain('documentation')

    const help = formatConfigHelp('documentation')
    expect(help).toContain('files (array; required)')
    expect(help).toContain('Machine-readable schema: webtoolkit config --json documentation')
    expect(help).toContain('docs/**/*.md')

    expect(formatConfigHelp('environment')).not.toContain('Example:')
    expect(formatConfigHelp('packageManager')).toContain('Fields:')
    expect(formatConfigHelp('devWatch')).toContain('default="127.0.0.1"')
    expect(formatConfigHelp('upgrade')).toContain('singletonGuardCommand (object; optional)')
    expect(formatConfigHelp('repoCheck')).toContain('default=false')
    expect(formatConfigHelp('workspaceTests')).toContain('executionMode (string; optional; default="turbo")')
    expect(formatConfigHelp('guards')).toContain('internalLink')
    expect(formatConfigHelp('guards')).toContain('packageSurface')
    expect(formatConfigHelp('guards')).toContain('repositoryHygiene')
    expect(formatConfigHelp('guards')).toContain('workspaceManifest')
    expect(formatConfigHelp('guards')).toContain('forbiddenPathPatterns')
    expect(formatConfigHelp('guards')).toContain('packageDirectories')
    expect(formatConfigHelp('guards')).toContain('requireWorkspaceProtocol')
  })

  it('returns filtered JSON Schema and rejects unknown sections', () => {
    const schema = getConfigSchema('documentation')
    expect(schema).toMatchObject({
      type: 'object',
      properties: { documentation: { $ref: '#/$defs/documentation' } },
    })
    expect(() => getConfigSchema('missing')).toThrow('Available sections')
    expect(() => formatConfigHelp('missing')).toThrow('Available sections')
    expect(getConfigSchema('guards')).toMatchObject({
      properties: { guards: { $ref: '#/$defs/guards' } },
    })
  })

  it('prints human or JSON output and validates arguments', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    runConfigReference([])
    expect(info).toHaveBeenLastCalledWith(expect.stringContaining('Configuration file'))

    runConfigReference(['--help', 'documentation'])
    expect(info).toHaveBeenLastCalledWith(expect.stringContaining('files (array; required)'))

    runConfigReference(['--json', 'documentation'])
    expect(() => JSON.parse(String(info.mock.calls.at(-1)?.[0]))).not.toThrow()

    expect(() => runConfigReference(['--unknown'])).toThrow('Usage:')
    expect(() => runConfigReference(['documentation', 'cleaner'])).toThrow('Usage:')
  })

  it('accepts minimal and representative valid configurations', () => {
    expect(() => validateConfig({})).not.toThrow()
    expect(() => validateConfig({
      guards: {
        any: { includePaths: ['apps'] },
        internalLink: { includePaths: ['apps/web/src'] },
        repositoryHygiene: {
          forbiddenPathPatterns: ['(^|/)\\.env$'],
          allowedPathPatterns: ['(^|/)\\.env\\.example$'],
        },
        packageSurface: {
          packageDirectories: ['packages/library'],
          forbiddenPublishedPatterns: ['\\.test\\.'],
        },
        schema: {
          centralDirectory: 'packages/contracts/src',
          includePaths: ['apps/api/src'],
          builders: ['object'],
          excludePatterns: ['\\.generated\\.ts$'],
        },
        workspaceManifest: {
          packageRoots: ['apps', 'packages'],
          requireWorkspaceProtocol: true,
          peerRequirements: [{
            dependency: 'react',
            providers: ['packages/ui'],
            consumers: ['apps/web'],
          }],
        },
      },
      repoCheck: {
        steps: [{ label: 'Schema', builtinGuard: 'schema' }],
      },
      tasks: {
        build: {
          steps: [{ label: 'Build', command: 'npm', args: ['run', 'build'], cwd: 'apps/web' }],
        },
      },
      workspaceTests: {
        executionMode: 'package-local',
        workspaces: [{ name: 'Web', package: '@acme/web', path: 'apps/web' }],
      },
      bundleAudit: {
        appDirs: ['apps/web'],
        budgets: [{
          appDir: 'apps/web',
          label: 'main bundle',
          pattern: '^index-.*\\.js$',
          maxRawBytes: 500_000,
          required: true,
        }],
      },
      architectureMap: {
        includePaths: ['apps', 'packages', 'scripts'],
        outputDirectory: 'docs/generated',
        dependencyCruiserConfig: '.webtoolkit-cli/dependency-cruiser.cjs',
        initialExpandedDepth: 1,
      },
    })).not.toThrow()
  })

  it('rejects unknown fields, wrong types, and meaningless empty arrays', () => {
    expect(() => validateConfig(null)).toThrow('<root>')
    expect(() => validateConfig({ unknown: true })).toThrow('unknown')
    expect(() => validateConfig({ packageManager: 42 })).toThrow('packageManager')
    expect(() => validateConfig({ documentation: { files: [] } })).toThrow('documentation.files')
    expect(() => validateConfig({ guards: { codePattern: {
      tsconfig: 'tsconfig.json',
      modelsDirectory: 'src/models',
      rules: {},
    } } })).toThrow('guards.codePattern.rules')
    expect(() => validateConfig({
      guards: {
        schema: {
          centralDirectory: 'schemas',
          includePaths: ['src'],
          builders: [],
        },
      },
    })).toThrow('guards.schema.builders')
    expect(() => validateConfig({
      guards: {
        repositoryHygiene: {
          forbiddenPathPatterns: [],
          allowedPathPatterns: [],
        },
      },
    })).toThrow('guards.repositoryHygiene.forbiddenPathPatterns')
    expect(() => validateConfig({
      guards: {
        packageSurface: {
          packageDirectories: [],
          forbiddenPublishedPatterns: [],
        },
      },
    })).toThrow('guards.packageSurface.packageDirectories')
    expect(() => validateConfig({
      guards: {
        workspaceManifest: {
          packageRoots: [],
          requireWorkspaceProtocol: true,
          peerRequirements: [],
        },
      },
    })).toThrow('guards.workspaceManifest.packageRoots')
  })

  it('requires exactly one known runner for executable steps', () => {
    expect(() => validateConfig({
      repoCheck: { steps: [{ label: 'Missing' }] },
    })).toThrow('exactly one')
    expect(() => validateConfig({
      repoCheck: { steps: [{ label: 'Ambiguous', command: 'npm', builtinGuard: 'schema' }] },
    })).toThrow('exactly one')
    expect(() => validateConfig({
      repoCheck: { steps: [{ label: 'Unknown', builtinGuard: '__proto__' }] },
    })).toThrow('repoCheck.steps[0].builtinGuard')
    expect(() => validateConfig({
      devGrid: {
        layout: {
          rows: [{ panes: [{ title: 'Web', command: 'npm run dev' }] }],
        },
        preflightCommand: { label: 'Invalid', builtinGuard: 'schema' },
      },
    })).toThrow('devGrid.preflightCommand')
  })

  it('requires the hierarchical devGrid layout without legacy flat fields', () => {
    expect(() => validateConfig({
      devGrid: {
        layout: {
          rows: [
            { panes: [{ title: 'Frontend', command: 'npm run dev:frontend' }] },
            { panes: [{ title: 'Backend', command: 'npm run dev:backend' }] },
          ],
        },
      },
    })).not.toThrow()

    expect(() => validateConfig({
      devGrid: {
        panes: [{ title: 'Legacy', command: 'npm run dev' }],
      },
    })).toThrow('devGrid')
  })

  it('rejects unsafe paths and invalid regular expressions', () => {
    for (const unsafePath of ['/tmp/source', 'C:\\source', '../outside']) {
      expect(() => validateConfig({
        guards: { internalLink: { includePaths: [unsafePath] } },
      })).toThrow('guards.internalLink.includePaths[0]')
    }
    expect(() => validateConfig({
      guards: { internalLink: { includePaths: ['src'], excludePatterns: ['['] } },
    })).toThrow('must be a valid regular expression')
    expect(() => validateConfig({
      bundleAudit: {
        appDirs: ['apps/web'],
        budgets: [{ appDir: 'apps/web', label: 'main', pattern: '[', maxRawBytes: 10 }],
      },
    })).toThrow('must be a valid regular expression')
    expect(() => validateConfig({
      guards: {
        repositoryHygiene: {
          forbiddenPathPatterns: ['['],
          allowedPathPatterns: [],
        },
      },
    })).toThrow('guards.repositoryHygiene.forbiddenPathPatterns[0]')

    expect(() => validateConfig({
      architectureMap: {
        includePaths: ['apps'],
        outputDirectory: '../outside',
      },
    })).toThrow('architectureMap.outputDirectory')
    expect(() => validateConfig({
      architectureMap: {
        includePaths: ['apps'],
        outputDirectory: path.resolve('architecture-map-output'),
      },
    })).not.toThrow()
    expect(() => validateConfig({
      architectureMap: {
        includePaths: ['apps'],
        outputDirectory: 'generated',
        initialExpandedDepth: -1,
      },
    })).toThrow('architectureMap.initialExpandedDepth')
  })

  it('aggregates path-specific errors in one failure', () => {
    expect(() => validateConfig({
      extra: true,
      repoCheck: {
        steps: [
          { label: 'Unknown', builtinGuard: '__proto__' },
          { label: 'Missing' },
        ],
      },
      guards: {
        schema: {
          centralDirectory: '../schemas',
          includePaths: [],
          builders: ['object'],
          extra: true,
        },
      },
    })).toThrowError(expect.objectContaining({
      message: expect.stringContaining('repoCheck.steps[0].builtinGuard'),
    }))

    try {
      validateConfig({
        extra: true,
        repoCheck: { steps: [{ label: 'Missing' }] },
        guards: { internalLink: { includePaths: [], excludePatterns: ['['] } },
      })
    } catch (error) {
      expect((error as Error).message).toContain('- extra:')
      expect((error as Error).message).toContain('repoCheck.steps[0]')
      expect((error as Error).message).toContain('guards.internalLink.includePaths')
      expect((error as Error).message).toContain('guards.internalLink.excludePatterns[0]')
    }
  })
})
