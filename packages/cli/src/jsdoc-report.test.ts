import fs from 'node:fs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig } from './config.js'
import { runJSDocReport } from './jsdoc-report.js'

const roots: string[] = []
const originalInputIsTTY = Object.getOwnPropertyDescriptor(input, 'isTTY')
const originalOutputIsTTY = Object.getOwnPropertyDescriptor(output, 'isTTY')
const readlineMocks = vi.hoisted(() => ({
  close: vi.fn(),
  question: vi.fn().mockResolvedValue('no'),
}))

vi.mock('node:readline/promises', () => ({
  createInterface: () => readlineMocks,
}))

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'webtoolkit-jsdoc-'))
  roots.push(root)
  fs.mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { jsx: 'react-jsx', strict: true, target: 'ES2023' },
  }))
  return root
}

function runtime(root: string, overrides: Record<string, unknown> = {}) {
  return {
    cwd: root,
    config: mergeConfig({
      jsdocReport: {
        includePaths: ['src', 'missing'],
        ...overrides,
      },
    }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  readlineMocks.close.mockClear()
  readlineMocks.question.mockReset().mockResolvedValue('no')
  if (originalInputIsTTY) Object.defineProperty(input, 'isTTY', originalInputIsTTY)
  else delete (input as { isTTY?: boolean }).isTTY
  if (originalOutputIsTTY) Object.defineProperty(output, 'isTTY', originalOutputIsTTY)
  else delete (output as { isTTY?: boolean }).isTTY
  delete process.env.JSDOC_MAX_LINE_LENGTH
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('JSDoc report', () => {
  it('requires configured include paths', async () => {
    await expect(runJSDocReport({ cwd: '/repo', config: mergeConfig() }, [])).rejects.toThrow('not configured')
  })

  it('reports a fully documented file and writes an empty Markdown report', async () => {
    const root = createRoot()
    fs.mkdirSync(join(root, 'src', 'nested'))
    fs.mkdirSync(join(root, 'src', 'node_modules'))
    writeFileSync(join(root, 'src', 'nested', 'ignored.js'), 'export const ignored = true\n')
    writeFileSync(join(root, 'src', 'node_modules', 'ignored.ts'), 'export function ignored() {}\n')
    writeFileSync(join(root, 'src', 'good.ts'), [
      '/** Adds values.',
      ' * @param {number} left - Left value.',
      ' * @param {number} right - Right value.',
      ' * @returns {number} Sum.',
      ' */',
      'export function add(left: number, right: number): number { return left + right }',
      '/** Model. */',
      'export interface Model {}',
      '/** Alias. */',
      'export type Alias = string',
      '/** Named. */',
      'export class Named {',
      '  /** Value. */',
      '  value = 1',
      '  /** Creates a value.',
      '   * @param {string} value - Value.',
      '   */',
      '  constructor(value: string) { void value }',
      '  /** Reads a value.',
      '   * @returns {string} Value.',
      '   */',
      '  read(): string { return "" }',
      '}',
      '/** Inferred.',
      ' * @returns {number} Value.',
      ' */',
      'export function inferred() { return 1 }',
      '/** Anonymous.',
      ' * @returns {number} Value.',
      ' */',
      'export default function () : number { return 1 }',
      '/** Variable.',
      ' * @returns {number} Value.',
      ' */',
      'export const variable = function (): number { return 1 }',
    ].join('\n'))
    writeFileSync(join(root, 'src', 'nested', 'good.ts'), '/** Nested. */\nexport interface Nested {}\n')
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runJSDocReport(runtime(root), ['--write'])

    expect(info.mock.calls.flat().join('\n')).toContain('All analyzed symbols are documented')
    expect(fs.readFileSync(join(root, 'temp_jsdocs_check.md'), 'utf8')).toContain('All analyzed symbols are documented')
  })

  it('reports validation issues across every supported symbol kind', async () => {
    const root = createRoot()
    process.env.JSDOC_MAX_LINE_LENGTH = '30'
    writeFileSync(join(root, 'src', 'issues.tsx'), [
      'export type MissingTypeDocs = string',
      'export interface MissingInterfaceDocs { value: string }',
      'export class MissingClassDocs {',
      '  missingProperty: string = ""',
      '  /** Method description that is deliberately much too long for the configured line length.',
      '   * @param value no separator',
      '   * @param {String} value - duplicate',
      '   * @param {number} extra - extra',
      '   * @returns wrong',
      '   */',
      '  method(value?: string): number { return value?.length ?? 0 }',
      '}',
      '/** Description.',
      ' * @param {number} [required] - mismatch.',
      ' * @returns {number} Value.',
      ' */',
      'export function mismatches(required: number): string { return String(required) }',
      '/**',
      ' * @param {string} value - Value.',
      ' * @returns {string} Value.',
      ' */',
      'export function missingDescription(value: string): string { return value }',
      '/** @description Destructured.',
      ' * @param {Object} options.value - Nested.',
      ' */',
      'export function destructured({ value }: { value: string }): void { void value }',
      '/** Rest.',
      ' * @param {...string} ...values - Values.',
      ' * @returns {number} Count.',
      ' */',
      'export const rest = (...values: string[]): number => values.length',
      '/** Expression.',
      ' * @param {boolean} [flag=true] - Flag.',
      ' * @returns {Boolean} Flag.',
      ' */',
      'export const expression = function(flag = true): boolean { return flag }',
      '/** Complex.',
      ' * @param {{ value: string }} input - Input.',
      ' * @returns {{ value: string }} Input.',
      ' */',
      'export function complex(input: { value: string }): { value: string } { return input }',
      '/** Predicate.',
      ' * @param {unknown} value - Value.',
      ' * @returns {boolean} Predicate.',
      ' */',
      'export function predicate(value: unknown): value is string { return typeof value === "string" }',
      '/** Missing params. */',
      'export function missingParam(value: string): undefined { return undefined }',
      '/** No return tag. */',
      'export function missingReturn(): string { return "" }',
      '/** Anonymous class. */',
      'export default class { /** Constructor. */ constructor() {} }',
    ].join('\n'))
    writeFileSync(join(root, 'src', 'anonymous.ts'), 'export default function (): string { return "" }\n')
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runJSDocReport(runtime(root, { maxLineLength: 200 }), ['--no-report'])

    const report = info.mock.calls.flat().join('\n')
    expect(report).toContain('Missing JSDoc')
    expect(report).toContain('type mismatch')
    expect(report).toContain('Duplicated @param')
    expect(report).toContain('Missing separator')
    expect(report).toContain('not present in signature')
    expect(report).toContain('Missing @returns')
    expect(report).toContain('line too long')
  })

  it('sorts and truncates console reports while writing all Markdown sections', async () => {
    const root = createRoot()
    for (let index = 0; index < 12; index += 1) {
      writeFileSync(join(root, 'src', `missing-${index}.ts`), `export function missing${index}(value: string): string { return value }\n`)
    }
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runJSDocReport(runtime(root, { reportFile: 'report.md' }), ['--report'])

    expect(info.mock.calls.flat().join('\n')).toContain('...and 2 more files')
    expect(fs.readFileSync(join(root, 'report.md'), 'utf8')).toContain('### 12.')
  })

  it('colors yellow and green aggregate coverage bands', async () => {
    const yellowRoot = createRoot()
    writeFileSync(join(yellowRoot, 'src', 'yellow.ts'), [
      '/** Good. */',
      'export interface Good {}',
      'export interface Missing {}',
    ].join('\n'))
    const greenRoot = createRoot()
    writeFileSync(join(greenRoot, 'src', 'green.ts'), [
      '/** One. */ export interface One {}',
      '/** Two. */ export interface Two {}',
      '/** Three. */ export interface Three {}',
      '/** Four. */ export interface Four {}',
      'export interface Missing {}',
    ].join('\n'))
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runJSDocReport(runtime(yellowRoot), ['--no-report'])
    await runJSDocReport(runtime(greenRoot), ['--no-report'])

    const report = info.mock.calls.flat().join('\n')
    expect(report).toContain('\u001b[33m50.0%')
    expect(report).toContain('\u001b[32m80.0%')
  })

  it('uses explicit existing file arguments and skips missing arguments', async () => {
    const root = createRoot()
    const file = join(root, 'src', 'single.ts')
    writeFileSync(file, 'export const value = 1\n')
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await runJSDocReport(runtime(root), ['src/single.ts', 'missing.ts', '--no-report'])

    expect(info).toHaveBeenCalledWith(expect.stringContaining('Analyzing 1 TypeScript file'))
  })

  it('reports source-file analysis errors without aborting', async () => {
    const root = createRoot()
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runJSDocReport(runtime(root), ['src', '--no-report'])

    expect(error).toHaveBeenCalledWith(expect.stringContaining('Failed to analyze'))
  })

  it('honors prompt yes/no answers and non-interactive output', async () => {
    const root = createRoot()
    readlineMocks.question.mockResolvedValue(' Yes ')
    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await runJSDocReport(runtime(root, { promptForReport: true, reportFile: 'prompt.md' }), [])
    expect(fs.existsSync(join(root, 'prompt.md'))).toBe(true)
    expect(readlineMocks.close).toHaveBeenCalled()
  })

  it('does not prompt when disabled, explicitly rejected, or non-interactive', async () => {
    const root = createRoot()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await runJSDocReport(runtime(root), [])
    await runJSDocReport(runtime(root, { promptForReport: true }), ['--no-report'])
    await runJSDocReport(runtime(root, { promptForReport: true }), [])
    expect(fs.readdirSync(root)).not.toContain('temp_jsdocs_check.md')
  })
})
