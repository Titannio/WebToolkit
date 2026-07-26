import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BASE_JSX_EXTENSIONS,
  BASE_SOURCE_EXCLUDE_PATTERNS,
  BASE_SOURCE_EXTENSIONS,
  assertConfiguredScanScope,
  compilePatterns,
  hasExtension,
  isMainModule,
  loadGuardConfig,
  resolveProjectPath,
} from './guard-config.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('guard safe bases', () => {
  it('covers modern JS/TS sources and common test layouts', () => {
    for (const file of ['source.ts', 'source.tsx', 'source.mts', 'source.cts', 'source.js', 'source.jsx', 'source.mjs', 'source.cjs']) {
      expect(hasExtension(file, BASE_SOURCE_EXTENSIONS)).toBe(true)
    }
    expect(hasExtension('Component.tsx', BASE_JSX_EXTENSIONS)).toBe(true)
    expect(hasExtension('module.ts', BASE_JSX_EXTENSIONS)).toBe(false)

    const patterns = compilePatterns([], BASE_SOURCE_EXCLUDE_PATTERNS)
    for (const file of ['node_modules/pkg/index.ts', 'dist/index.js', 'src/example.test.ts', 'src/example.test-builders.ts', 'tests/example.ts', 'src/Example.stories.tsx']) {
      expect(patterns.some((pattern) => pattern.test(file))).toBe(true)
    }
  })

  it('adds consumer patterns and rejects invalid regular expressions', () => {
    expect(compilePatterns(['generated/']).some((pattern) => pattern.test('generated/file.ts'))).toBe(true)
    expect(() => compilePatterns(['['])).toThrow('Invalid regular expression')
    expect(() => resolveProjectPath('/repo', '../outside')).toThrow('must stay inside')
  })

  it('rejects missing, wrong-kind, and zero-match scan scopes', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'webtoolkit-scope-'))
    tempDirectories.push(root)
    mkdirSync(path.join(root, 'empty'))
    writeFileSync(path.join(root, 'file.ts'), 'export {}', 'utf8')

    const assertScope = (configuredPaths: string[], eligibleFiles: string[] = []) => (
      assertConfiguredScanScope({
        root,
        guardName: 'schema',
        configPath: 'guards.schema.includePaths',
        configuredPaths,
        eligibleFiles,
      })
    )

    expect(() => assertScope(['missing'])).toThrow('missing directory: missing')
    expect(() => assertScope(['file.ts'])).toThrow('must contain directories')
    expect(() => assertScope(['empty'])).toThrow('matched zero eligible files')
  })

  it('accepts combined scopes when at least one eligible file was collected', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'webtoolkit-scope-'))
    tempDirectories.push(root)
    mkdirSync(path.join(root, 'empty'))
    mkdirSync(path.join(root, 'source'))
    const eligibleFile = path.join(root, 'source', 'index.ts')
    writeFileSync(eligibleFile, 'export {}', 'utf8')

    expect(() => assertConfiguredScanScope({
      root,
      guardName: 'code-pattern',
      configPath: 'guards.codePattern.rules.rule.includePaths',
      configuredPaths: ['empty', 'source'],
      eligibleFiles: [eligibleFile],
    })).not.toThrow()
  })

  it('preserves unexpected filesystem errors while validating scan scopes', () => {
    const failure = Object.assign(new Error('access denied'), { code: 'EACCES' })
    vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw failure
    })

    expect(() => assertConfiguredScanScope({
      root: '/repo',
      guardName: 'schema',
      configPath: 'guards.schema.includePaths',
      configuredPaths: ['source'],
      eligibleFiles: ['/repo/source/index.ts'],
    })).toThrow(failure)
  })

  it('loads configured guard policy and rejects missing configuration', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'webtoolkit-guard-config-'))
    tempDirectories.push(root)
    mkdirSync(path.join(root, '.webtoolkit-cli'))
    writeFileSync(path.join(root, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: { internalLink: { includePaths: ['src'] } },
    }), 'utf8')

    await expect(loadGuardConfig('internalLink', root)).resolves.toEqual({ includePaths: ['src'] })
    await expect(loadGuardConfig('schema', root)).rejects.toThrow('guards.schema is not configured')

    const noConfig = mkdtempSync(path.join(os.tmpdir(), 'webtoolkit-guard-config-'))
    tempDirectories.push(noConfig)
    await expect(loadGuardConfig('schema', noConfig)).rejects.toThrow('guards.schema is not configured')
  })
})

describe('main module detection', () => {
  it('recognizes direct execution and rejects missing or different entrypoints', () => {
    expect(isMainModule(import.meta.url, ['node', fileURLToPath(import.meta.url)])).toBe(true)
    expect(isMainModule(import.meta.url, ['node', process.execPath])).toBe(false)
    expect(isMainModule(import.meta.url, ['node'])).toBe(false)
  })

  it('recognizes a pnpm-style symlinked entrypoint', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'webtoolkit-main-module-'))
    tempDirectories.push(root)
    const storeDirectory = path.join(root, 'store', 'package')
    const linkedDirectory = path.join(root, 'node_modules', 'package')
    const storeEntrypoint = path.join(storeDirectory, 'bin.js')
    mkdirSync(storeDirectory, { recursive: true })
    mkdirSync(path.dirname(linkedDirectory), { recursive: true })
    writeFileSync(storeEntrypoint, '', 'utf8')
    fs.symlinkSync(storeDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir')

    expect(isMainModule(pathToFileURL(storeEntrypoint).href, ['node', path.join(linkedDirectory, 'bin.js')])).toBe(true)
  })
})
