import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnyGuardConfig } from '../config.js'
import { runAnyGuard } from './any-guard.js'

const roots: string[] = []
const config: AnyGuardConfig = { includePaths: ['apps'] }

async function fixture(source?: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-any-'))
  roots.push(root)
  await mkdir(path.join(root, 'apps'), { recursive: true })
  if (source !== undefined) {
    await writeFile(path.join(root, 'apps', 'source.ts'), source, 'utf8')
  }
  return root
}

async function run(root: string, override: AnyGuardConfig = config): Promise<number> {
  return runAnyGuard({ rootDir: root, config: override })
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('any guard', () => {
  it('accepts typed code and authorization on the nearest declaration', async () => {
    const root = await fixture([
      'export const value: unknown = 1',
      '/** @anyAllowed */',
      'export function legacy(value: any): any { return value }',
    ].join('\n'))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(await run(root)).toBe(0)
  })

  it.each([
    ['variable annotation', 'let value: any'],
    ['parameter annotation', 'function value(input: any): void {}'],
    ['return annotation', 'function value(): any { throw new Error() }'],
    ['property annotation', 'interface Value { field: any }'],
    ['type alias and union', 'type Value = string | any'],
    ['generic argument', 'type Value = Array<any>'],
    ['generic constraint', 'type Value<T extends any> = T'],
    ['array', 'type Value = any[]'],
    ['tuple', 'type Value = [string, any]'],
    ['as assertion', 'declare const input: unknown; const value = input as any'],
    ['angle assertion', 'declare const input: unknown; const value = <any>input'],
    ['nested parenthesized type', 'type Value = (any)[]'],
  ])('detects %s', async (_name, source) => {
    const root = await fixture(source)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await run(root)).toBe(1)
  })

  it('reports every keyword with exact line and column, including the same line', async () => {
    const root = await fixture('const first: any = null as any')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await run(root)).toBe(1)
    const findings = error.mock.calls.flat().map(String).filter((line) => line.includes('apps/source.ts:1:'))
    expect(findings).toHaveLength(2)
  })

  it('ignores comments, strings, JSDoc types, test files, unsupported files, and configured exclusions', async () => {
    const root = await fixture([
      'const text = "any"',
      '// const ignored: any = 1',
      '/** @returns {any} documentation only */',
      'export function documented(): unknown { return text }',
    ].join('\n'))
    await writeFile(path.join(root, 'apps', 'ignored.test.ts'), 'const value: any = 1', 'utf8')
    await writeFile(path.join(root, 'apps', 'ignored.txt'), 'const value: any = 1', 'utf8')
    await mkdir(path.join(root, 'apps', 'nested'), { recursive: true })
    await writeFile(path.join(root, 'apps', 'nested', 'clean.ts'), 'export {}', 'utf8')
    await mkdir(path.join(root, 'apps', 'generated'), { recursive: true })
    await writeFile(path.join(root, 'apps', 'generated', 'client.ts'), 'const value: any = 1', 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(await run(root, {
      includePaths: ['apps'],
      excludePatterns: ['(^|/)generated(?:/|$)'],
    })).toBe(0)
  })

  it('does not let an outer authorization exempt a nearer declaration', async () => {
    const root = await fixture([
      '/** @anyAllowed */',
      'class Legacy {',
      '  method(value: any): void {}',
      '}',
    ].join('\n'))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await run(root)).toBe(1)
  })

  it('uses configured paths and accepts multiple paths with eligible files', async () => {
    const root = await fixture('export const value: unknown = 1')
    await mkdir(path.join(root, 'packages'), { recursive: true })
    await writeFile(path.join(root, 'packages', 'index.ts'), 'export {}', 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(await run(root, { includePaths: ['apps', 'packages'] })).toBe(0)
  })

  it('rejects missing, empty, and excluded-only scopes', async () => {
    const missingRoot = await fixture('export {}')
    await expect(run(missingRoot, { includePaths: ['missing'] })).rejects.toThrow('missing directory')

    const emptyRoot = await fixture()
    await expect(run(emptyRoot)).rejects.toThrow('zero eligible files')

    const excludedRoot = await fixture()
    await writeFile(path.join(excludedRoot, 'apps', 'only.test.ts'), 'const value: any = 1', 'utf8')
    await expect(run(excludedRoot)).rejects.toThrow('zero eligible files')
  })

  it('loads consumer policy when config is omitted and uses cwd when root is omitted', async () => {
    const root = await fixture('export const value: unknown = 1')
    await mkdir(path.join(root, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(root, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: { any: config },
    }), 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await expect(runAnyGuard({ rootDir: root })).resolves.toBe(0)
    await expect(runAnyGuard({ config: { includePaths: ['missing'] } })).rejects.toThrow('missing directory')
  })
})
