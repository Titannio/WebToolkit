import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Project } from 'ts-morph'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SchemaGuardConfig } from '../config.js'
import { findSchemaDefinitions, runSchemaGuard } from './schema-guard.js'

const roots: string[] = []
const config: SchemaGuardConfig = {
  centralDirectory: 'packages/contracts/src',
  includePaths: ['apps/api/src'],
  builders: ['object', 'enum', 'array', 'nativeEnum'],
}

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-schema-'))
  roots.push(directory)
  await mkdir(path.join(directory, 'packages', 'contracts', 'src'), { recursive: true })
  return directory
}

async function source(directory: string, contents: string, relativePath = 'apps/api/src/local.ts'): Promise<string> {
  const filePath = path.join(directory, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, contents, 'utf8')
  return filePath
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('schema guard', () => {
  it('detects configured builders in direct, fluent, property, class, assignment, and default-export definitions', async () => {
    const directory = await root()
    await source(directory, [
      'import { z } from "zod"',
      'const direct = z.object({})',
      'const fluent = z.enum(["a"]).optional()',
      'const definitions = { list: z.array(z.string()).min(1) }',
      'class Schemas { value = (z.object({}) as unknown).strict() }',
      'const registry: Record<string, unknown> = {}',
      'registry.schema = z.object({}).extend({})',
      'export default z.nativeEnum({ A: "a" })',
    ].join('\n'))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await runSchemaGuard({ rootDir: directory, config })).toBe(1)
    expect(error.mock.calls.flat().join('\n')).toContain('apps/api/src/local.ts')
  })

  it('reports a larger schema once instead of reporting nested builders', async () => {
    const directory = await root()
    const filePath = await source(directory, [
      'const schema = z.object({',
      '  items: z.array(z.object({ value: z.string() })),',
      '  child: z.object({}),',
      '}).strict()',
    ].join('\n'))

    expect(findSchemaDefinitions(
      filePath,
      new Project({ skipAddingFilesFromTsConfig: true }),
      config.builders,
    )).toHaveLength(1)
  })

  it('does not flag type helpers, other namespaces, wrapped arguments, or separate callback definitions as nesting', async () => {
    const directory = await root()
    const filePath = await source(directory, [
      'type Value = z.infer<typeof importedSchema>',
      'const other = validator.object({})',
      'const wrapped = factory(z.object({}))',
      'let absent: unknown',
      'const outer = z.object({}).superRefine(() => {',
      '  const separate = z.object({})',
      '})',
    ].join('\n'))

    expect(findSchemaDefinitions(
      filePath,
      new Project({ skipAddingFilesFromTsConfig: true }),
      config.builders,
    )).toHaveLength(2)
  })

  it('honors configured builders and exclusions', async () => {
    const directory = await root()
    await source(directory, 'const ignored = z.object({})', 'apps/api/src/generated/ignored.ts')
    await source(directory, 'const ignored = z.object({})', 'apps/api/src/generated/deep/ignored.ts')
    await source(directory, 'const allowed = z.string()', 'apps/api/src/allowed.ts')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(await runSchemaGuard({
      rootDir: directory,
      config: {
        ...config,
        builders: ['object'],
        excludePatterns: ['(^|/)generated/'],
      },
    })).toBe(0)
  })

  it('rejects missing, empty, and excluded-only scopes', async () => {
    const missingRoot = await root()
    await expect(runSchemaGuard({ rootDir: missingRoot, config })).rejects.toThrow('missing directory')

    const emptyRoot = await root()
    await mkdir(path.join(emptyRoot, 'apps', 'api', 'src'), { recursive: true })
    await expect(runSchemaGuard({ rootDir: emptyRoot, config })).rejects.toThrow('zero eligible files')

    const excludedRoot = await root()
    await source(excludedRoot, 'export {}', 'apps/api/src/only.test.ts')
    await expect(runSchemaGuard({ rootDir: excludedRoot, config })).rejects.toThrow('zero eligible files')
  })

  it('accepts multiple include paths when one has eligible files', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'api', 'src'), { recursive: true })
    await source(directory, 'export {}', 'apps/web/src/index.ts')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(await runSchemaGuard({
      rootDir: directory,
      config: { ...config, includePaths: ['apps/api/src', 'apps/web/src'] },
    })).toBe(0)
  })

  it('skips the configured central directory inside a broader scope', async () => {
    const directory = await root()
    await source(directory, 'export {}', 'apps/api/src/index.ts')
    await source(directory, 'const schema = z.object({})', 'packages/contracts/src/schema.ts')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(await runSchemaGuard({
      rootDir: directory,
      config: { ...config, includePaths: ['.'] },
    })).toBe(0)
  })

  it('defends direct callers from incomplete config', async () => {
    const directory = await root()
    await expect(runSchemaGuard({
      rootDir: directory,
      config: { centralDirectory: '', includePaths: [], builders: [] },
    })).rejects.toThrow('non-empty builders')
    await expect(runSchemaGuard({
      rootDir: directory,
      config: { centralDirectory: 'schemas', includePaths: [], builders: ['object'] },
    })).rejects.toThrow('non-empty includePaths')
    await expect(runSchemaGuard({
      rootDir: directory,
      config: { centralDirectory: 'schemas', includePaths: ['src'], builders: [] },
    })).rejects.toThrow('non-empty builders')
  })

  it('loads consumer policy when config is omitted and uses cwd when root is omitted', async () => {
    const directory = await root()
    await source(directory, 'export {}')
    await mkdir(path.join(directory, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(directory, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: { schema: config },
    }), 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await expect(runSchemaGuard({ rootDir: directory })).resolves.toBe(0)
    await expect(runSchemaGuard({
      config: { ...config, includePaths: ['missing'] },
    })).rejects.toThrow('missing directory')
  })
})
