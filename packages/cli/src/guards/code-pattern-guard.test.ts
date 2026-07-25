import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CodePatternGuardConfig } from '../config.js'
import {
  RULES,
  collectImportBindingIdentifiers,
  isTypeOnlyUsage,
  runCodePatternGuard,
  shouldPreferTypeImport,
} from './code-pattern-guard.js'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('code-pattern guard rule attribution', () => {
  it.each([
    ['backend-mongoose-connect-only-in-ops-and-test-bootstrap', 'mongoose.connect()'],
    ['backend-mongoose-model-only-in-model-layer-or-allowlist', 'mongoose.model("User")'],
    ['backend-no-destructive-bulk-ops-outside-tests-and-maintenance', 'User.deleteMany({})'],
    ['backend-no-new-schema-mixed-usage', 'const value = Schema.Types.Mixed'],
    ['backend-controllers-no-validated-request-casts', 'const body = req.body as Input'],
  ])('attributes violations to %s', (ruleId, source) => {
    const rule = RULES.find((candidate) => candidate.id === ruleId)
    if (!rule) throw new Error(`Missing rule ${ruleId}`)

    const filePath = path.resolve('src/example.ts')
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const violations = rule.check(sourceFile, filePath, {} as Parameters<typeof rule.check>[2], rule)

    expect(violations).not.toHaveLength(0)
    expect(violations.every((violation) => violation.ruleId === ruleId)).toBe(true)
  })

  it.each([
    ['backend-mongoose-no-direct-models-import', 'import { models } from "mongoose"'],
    ['backend-no-direct-process-env', 'const value = process.env.SECRET'],
    ['no-inline-parameter-object-types-in-production', 'function run(options: { value: string }) { return options }'],
    ['frontend-no-direct-axios-imports-outside-http-boundary', 'import axios from "axios"'],
    ['frontend-no-services-api-imports-outside-shared-service-boundary', 'export { api } from "./services/api/client"'],
  ])('covers the %s rule', (ruleId, source) => {
    const rule = RULES.find((candidate) => candidate.id === ruleId)
    if (!rule) throw new Error(`Missing rule ${ruleId}`)
    const filePath = path.resolve('src/example.ts')
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const violations = rule.check(sourceFile, filePath, {} as Parameters<typeof rule.check>[2], rule)
    expect(violations.every((violation) => violation.ruleId === ruleId)).toBe(true)
    expect(violations).not.toHaveLength(0)
  })

  it('returns no violations for neutral source across the catalog', () => {
    const filePath = path.resolve('src/example.ts')
    const sourceFile = ts.createSourceFile(filePath, 'export const value = 1', ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const rule of RULES) {
      expect(rule.check(sourceFile, filePath, {} as Parameters<typeof rule.check>[2], rule)).toEqual([])
    }
  })

  it.each([
    ['backend-mongoose-no-direct-models-import', 'import { models as renamed } from "mongoose"'],
    ['backend-no-direct-process-env', 'const value = process.env["SECRET"]'],
    ['no-inline-parameter-object-types-in-production', `
      class Example {
        constructor(options: { value: string }) {}
        method(input: { value: string }) {}
      }
      const arrow = (input: { value: string }) => input
      const expression = function (input: { value: string }) { return input }
    `],
    ['backend-mongoose-connect-only-in-ops-and-test-bootstrap', 'mongoose.disconnect()'],
    ['backend-no-destructive-bulk-ops-outside-tests-and-maintenance', `
      collection.dropDatabase()
      collection.dropCollection()
      collection.deleteMany({ active: false })
    `],
    ['backend-controllers-no-validated-request-casts', `
      const body = (req.body as unknown) as Input
      const query = req["query"] as Query
      const params = req.params.value as string
    `],
    ['frontend-no-services-api-imports-outside-shared-service-boundary', 'import api from "./services/api/client"'],
  ])('covers alternate AST shapes for %s', (ruleId, source) => {
    const rule = RULES.find((candidate) => candidate.id === ruleId)
    if (!rule) throw new Error(`Missing rule ${ruleId}`)
    const filePath = path.resolve('src/example.ts')
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    expect(rule.check(sourceFile, filePath, {} as Parameters<typeof rule.check>[2], rule)).not.toEqual([])
  })

  it('classifies import bindings and type-only AST positions', () => {
    const sourceFile = ts.createSourceFile('types.ts', `
      import DefaultType from './default.js'
      import * as Namespace from './namespace.js'
      import { Named as Alias } from './named.js'
      type Qualified = Namespace.Value
      class Implements implements Alias {}
      interface Extends extends Alias {}
      class RuntimeExtends extends DefaultType {}
      type Query = typeof DefaultType
      const runtime = Alias
    `, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const imports = sourceFile.statements.filter(ts.isImportDeclaration)
    expect(collectImportBindingIdentifiers(imports[0].importClause!).map((binding) => binding.text)).toEqual(['DefaultType'])
    expect(collectImportBindingIdentifiers(imports[1].importClause!).map((binding) => binding.text)).toEqual(['Namespace'])
    expect(collectImportBindingIdentifiers(imports[2].importClause!).map((binding) => binding.text)).toEqual(['Alias'])

    const identifiers: ts.Identifier[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) identifiers.push(node)
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    const usages = (name: string) => identifiers.filter((identifier) => identifier.text === name).slice(1)
    expect(usages('Namespace').some(isTypeOnlyUsage)).toBe(true)
    expect(usages('Alias').some(isTypeOnlyUsage)).toBe(true)
    expect(usages('Alias').some((identifier) => !isTypeOnlyUsage(identifier))).toBe(true)
    const typeQueryIdentifier = identifiers.find((identifier) => (
      identifier.text === 'DefaultType' && ts.isTypeQueryNode(identifier.parent)
    ))
    expect(typeQueryIdentifier && isTypeOnlyUsage(typeQueryIdentifier)).toBe(false)
  })

  it('ignores non-matching AST variants across the rule catalog', () => {
    const cases: Array<[string, string]> = [
      ['backend-mongoose-no-direct-models-import', 'import "mongoose"; import { Schema } from "mongoose"; import { models } from "other"; import { models as invalid } from 42'],
      ['backend-no-direct-process-env', 'const key = "SECRET"; const first = process.env[key]; const second = process.version'],
      ['no-inline-parameter-object-types-in-production', 'type Input = { value: string }; function run(input: Input, untyped) { return input }'],
      ['backend-mongoose-connect-only-in-ops-and-test-bootstrap', 'mongoose.syncIndexes()'],
      ['backend-no-destructive-bulk-ops-outside-tests-and-maintenance', 'User.deleteMany({ active: false }); User.updateMany({})'],
      ['backend-controllers-no-validated-request-casts', 'const user = req.user as User'],
      ['frontend-no-direct-axios-imports-outside-http-boundary', 'import fetcher from "fetcher"; import axios from 42'],
      ['frontend-no-services-api-imports-outside-shared-service-boundary', 'import value from "./other"; const text = "services/api/client"'],
    ]

    for (const [ruleId, source] of cases) {
      const rule = RULES.find((candidate) => candidate.id === ruleId)!
      const filePath = path.resolve('src/neutral.ts')
      const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      expect(rule.check(sourceFile, filePath, {} as Parameters<typeof rule.check>[2], rule)).toEqual([])
    }

    const castRule = RULES.find((candidate) => candidate.id === 'backend-controllers-no-validated-request-casts')!
    const nestedCast = ts.createSourceFile(
      'nested.ts',
      'const body = req.body as unknown as Input',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    expect(castRule.check(
      nestedCast,
      path.resolve('nested.ts'),
      {} as Parameters<typeof castRule.check>[2],
      castRule,
    )).toHaveLength(1)
  })
})

async function fixture(source = 'export const value = 1'): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-code-pattern-'))
  roots.push(root)
  await mkdir(path.join(root, 'apps', 'api', 'src'), { recursive: true })
  await mkdir(path.join(root, 'apps', 'api', 'models'), { recursive: true })
  await writeFile(path.join(root, 'apps', 'api', 'src', 'index.ts'), source, 'utf8')
  await writeFile(path.join(root, 'apps', 'api', 'tsconfig.json'), JSON.stringify({
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
    include: ['src'],
  }), 'utf8')
  return root
}

function config(includePaths = ['apps/api/src']): CodePatternGuardConfig {
  return {
    tsconfig: 'apps/api/tsconfig.json',
    modelsDirectory: 'apps/api/models',
    rules: {
      'backend-no-direct-process-env': { includePaths },
    },
  }
}

describe('code-pattern guard runner', () => {
  it('detects type-only imports with a real type checker', { timeout: 15_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-code-pattern-types-'))
    roots.push(root)
    const typesFile = path.join(root, 'types.ts')
    const sourceFilePath = path.join(root, 'source.ts')
    await writeFile(typesFile, 'export interface Value { id: string }', 'utf8')
    await writeFile(sourceFilePath, [
      "import { Value } from './types.js'",
      'export type Result = Value',
    ].join('\n'), 'utf8')
    const program = ts.createProgram([typesFile, sourceFilePath], {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    })
    const sourceFile = program.getSourceFile(sourceFilePath)
    if (!sourceFile) throw new Error('Missing source file')
    const declaration = sourceFile.statements.find(ts.isImportDeclaration)
    if (!declaration) throw new Error('Missing import')
    expect(shouldPreferTypeImport(declaration, sourceFile, program.getTypeChecker())).toBe(true)

    await writeFile(sourceFilePath, [
      "import { Value } from './types.js'",
      'export const runtime = Value',
    ].join('\n'), 'utf8')
    const runtimeProgram = ts.createProgram([typesFile, sourceFilePath], {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    })
    const runtimeSource = runtimeProgram.getSourceFile(sourceFilePath)!
    expect(shouldPreferTypeImport(
      runtimeSource.statements.find(ts.isImportDeclaration)!,
      runtimeSource,
      runtimeProgram.getTypeChecker(),
    )).toBe(false)

    const missingSymbolSource = ts.createSourceFile(
      'missing-symbol.ts',
      "import { Value } from './types.js'\ntype Result = Value",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    expect(shouldPreferTypeImport(
      missingSymbolSource.statements.find(ts.isImportDeclaration)!,
      missingSymbolSource,
      { getSymbolAtLocation: () => undefined } as unknown as ts.TypeChecker,
    )).toBe(false)

    const isolated = ts.createSourceFile('isolated.ts', `
      import type { Value } from './types.js'
      import './side-effect.js'
      import {} from './empty.js'
    `, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const importDeclaration of isolated.statements.filter(ts.isImportDeclaration)) {
      expect(shouldPreferTypeImport(
        importDeclaration,
        isolated,
        runtimeProgram.getTypeChecker(),
      )).toBe(false)
    }
  })

  it('accepts compliant files, reports violations, and honors allowlists', { timeout: 15_000 }, async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await runCodePatternGuard({ rootDir: await fixture(), config: config() })).toBe(0)

    const violating = await fixture('export const value = process.env.SECRET')
    expect(await runCodePatternGuard({ rootDir: violating, config: config() })).toBe(1)

    const allowed = await fixture('export const value = process.env.SECRET')
    const allowedConfig = config()
    allowedConfig.rules['backend-no-direct-process-env'].allowedPathPatterns = ['^apps/api/src/index\\.ts$']
    expect(await runCodePatternGuard({ rootDir: allowed, config: allowedConfig })).toBe(0)
  })

  it('rejects unknown rules and missing, empty, or excluded-only scopes', async () => {
    const validRoot = await fixture()
    await expect(runCodePatternGuard({
      rootDir: validRoot,
      config: {
        ...config(),
        rules: { unknown: { includePaths: ['apps/api/src'] } },
      },
    })).rejects.toThrow('Unknown code-pattern rule')
    await expect(runCodePatternGuard({
      rootDir: validRoot,
      config: { ...config(), rules: {} },
    })).rejects.toThrow('must not be empty')

    const missing = await fixture()
    await expect(runCodePatternGuard({
      rootDir: missing,
      config: config(['apps/missing']),
    })).rejects.toThrow('missing directory')

    const empty = await fixture()
    await mkdir(path.join(empty, 'apps', 'empty'), { recursive: true })
    await expect(runCodePatternGuard({
      rootDir: empty,
      config: config(['apps/empty']),
    })).rejects.toThrow('zero eligible files')

    const excluded = await fixture()
    await mkdir(path.join(excluded, 'dist'), { recursive: true })
    await writeFile(path.join(excluded, 'dist', 'index.ts'), 'export {}', 'utf8')
    await expect(runCodePatternGuard({
      rootDir: excluded,
      config: config(['dist']),
    })).rejects.toThrow('zero eligible files')
  })

  it('accepts combined include paths when one has eligible files', async () => {
    const root = await fixture()
    await mkdir(path.join(root, 'apps', 'empty'), { recursive: true })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await runCodePatternGuard({
      rootDir: root,
      config: config(['apps/empty', 'apps/api/src']),
    })).toBe(0)
  })

  it('checks resolved model imports and distinguishes mapper type-only usage', { timeout: 15_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-code-pattern-model-'))
    roots.push(root)
    await mkdir(path.join(root, 'apps', 'backend', 'src', 'models'), { recursive: true })
    await mkdir(path.join(root, 'apps', 'backend', 'src', 'services'), { recursive: true })
    await mkdir(path.join(root, 'apps', 'backend', 'src', 'mappers'), { recursive: true })
    await writeFile(
      path.join(root, 'apps', 'backend', 'src', 'models', 'user.ts'),
      'export interface User { id: string }\nexport const runtimeUser = { id: "1" }',
      'utf8',
    )
    await writeFile(
      path.join(root, 'apps', 'backend', 'src', 'services', 'user.ts'),
      "import { runtimeUser } from '../models/user.js'\nexport const user = runtimeUser",
      'utf8',
    )
    await writeFile(
      path.join(root, 'apps', 'backend', 'src', 'mappers', 'user.ts'),
      [
        "import { User } from '../models/user.js'",
        "import { runtimeUser } from '../models/user.js'",
        "import './missing.js'",
        "import { helper } from '../utils/helper.js'",
        'import { invalid } from 42',
        'export const map = (user: User) => `${user.id}${runtimeUser.id}${helper}`',
      ].join('\n'),
      'utf8',
    )
    await mkdir(path.join(root, 'apps', 'backend', 'src', 'utils'), { recursive: true })
    await writeFile(path.join(root, 'apps', 'backend', 'src', 'utils', 'helper.ts'), 'export const helper = 1', 'utf8')
    await writeFile(path.join(root, 'apps', 'backend', 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true },
      include: ['src'],
    }), 'utf8')
    const modelConfig: CodePatternGuardConfig = {
      tsconfig: 'apps/backend/tsconfig.json',
      modelsDirectory: 'apps/backend/src/models',
      rules: {
        'backend-no-direct-model-imports-outside-allowed-zones': {
          includePaths: ['apps/backend/src/services', 'apps/backend/src/mappers'],
        },
      },
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await runCodePatternGuard({ rootDir: root, config: modelConfig })).toBe(1)
    expect(log.mock.calls.flat().join('\n')).toContain('Prefira `import type`')

    await writeFile(
      path.join(root, 'apps', 'backend', 'src', 'mappers', 'user.ts'),
      "import { User } from '../models/user.js'\nexport const map = (user: User) => user.id",
      'utf8',
    )
    expect(await runCodePatternGuard({
      rootDir: root,
      config: {
        ...modelConfig,
        rules: {
          'backend-no-direct-model-imports-outside-allowed-zones': {
            includePaths: ['apps/backend/src/mappers'],
          },
        },
      },
    })).toBe(0)
  })

  it('parses eligible files outside the tsconfig program and reports malformed tsconfig', async () => {
    const root = await fixture()
    await mkdir(path.join(root, 'scripts', 'nested'), { recursive: true })
    for (const file of ['file.tsx', 'file.jsx', 'file.js', 'file.mjs', 'file.cjs', 'file.ts']) {
      await writeFile(path.join(root, 'scripts', 'nested', file), 'export const value = 1', 'utf8')
    }
    await writeFile(path.join(root, 'scripts', 'nested', 'ignored.txt'), 'ignored', 'utf8')
    await mkdir(path.join(root, 'scripts', 'nested', 'dist'), { recursive: true })
    await writeFile(path.join(root, 'scripts', 'nested', 'dist', 'ignored.ts'), 'process.env.SECRET', 'utf8')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await runCodePatternGuard({
      rootDir: root,
      config: config(['scripts']),
    })).toBe(0)

    const malformed = await fixture()
    await writeFile(path.join(malformed, 'apps', 'api', 'tsconfig.json'), '{', 'utf8')
    await expect(runCodePatternGuard({
      rootDir: malformed,
      config: config(),
    })).rejects.toThrow('Failed to read backend tsconfig')

    await rm(path.join(malformed, 'apps', 'api', 'tsconfig.json'), { force: true })
    await mkdir(path.join(malformed, 'apps', 'api', 'tsconfig.json'))
    await expect(runCodePatternGuard({
      rootDir: malformed,
      config: config(),
    })).rejects.toThrow('Failed to read backend tsconfig')
  })

  it('evaluates multiple disjoint rule scopes and reports only matching files', async () => {
    const root = await fixture('export const value = process.env.SECRET')
    await mkdir(path.join(root, 'scripts'), { recursive: true })
    await writeFile(path.join(root, 'scripts', 'client.ts'), 'export const client = 1', 'utf8')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(await runCodePatternGuard({
      rootDir: root,
      config: {
        ...config(),
        rules: {
          'backend-no-direct-process-env': { includePaths: ['apps/api/src'] },
          'frontend-no-direct-axios-imports-outside-http-boundary': { includePaths: ['scripts'] },
        },
      },
    })).toBe(1)
  })

  it('loads consumer policy when config is omitted and uses cwd when root is omitted', async () => {
    const root = await fixture()
    await mkdir(path.join(root, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(root, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: { codePattern: config() },
    }), 'utf8')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(runCodePatternGuard({ rootDir: root })).resolves.toBe(0)
    await expect(runCodePatternGuard({
      config: { ...config(), tsconfig: 'missing.json' },
    })).rejects.toThrow('Failed to read backend tsconfig')
  })
})
