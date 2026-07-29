#!/usr/bin/env tsx
/**
 * Code Pattern Guard
 *
 * Detects prohibited or undesirable code patterns that are too specific for the
 * global lint configuration, but important enough to be enforced in the
 * architecture maintenance pipeline.
 *
 * This guard is intentionally conservative:
 * - it blocks patterns that are known to be dangerous for our runtime/build
 * - it keeps explicit allowlists for legacy or operational exceptions that are
 *   currently considered valid in the healthy system
 *
 * If a rule starts failing on the current mainline without a recent code change,
 * the rule itself should be reviewed before the code is considered broken.
 */

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { CodePatternGuardConfig } from '../config.js'
import {
  BASE_ARTIFACT_EXCLUDE_PATTERNS,
  BASE_SOURCE_EXTENSIONS,
  assertConfiguredScanScope,
  compilePatterns,
  hasExtension,
  isMainModule,
  loadGuardConfig,
  resolveProjectPath,
} from './guard-config.js'

/**
 * Terminal presentation helpers.
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

/**
 * Repository and backend path anchors used by multiple rules.
 */
/**
 * Generic file-system exclusions for this guard.
 */
const EXCLUDE_PATTERNS = compilePatterns([], BASE_ARTIFACT_EXCLUDE_PATTERNS)

type RuleSeverity = 'forbidden' | 'undesirable'

/**
 * A single concrete hit produced by a rule.
 */
type PatternViolation = {
  filePath: string
  line: number
  ruleId: string
  severity: RuleSeverity
  message: string
  snippet: string
}

/**
 * Shared runtime context prepared once and reused by the rules.
 */
type PatternContext = {
  rootDir: string
  backendProgram: ts.Program
  backendTypeChecker: ts.TypeChecker
  backendCompilerOptions: ts.CompilerOptions
  modelsDirectory: string
}

/**
 * Rule contract.
 *
 * The guard is intentionally step-based: each rule is one explicit stage in the
 * architecture check, with its own scope, rationale and allowlist.
 */
type PatternRule = {
  id: string
  severity: RuleSeverity
  summary: string
  rationale: string
  includeDirs: string[]
  allowedPathPatterns?: RegExp[]
  rootDir?: string
  check: (
    sourceFile: ts.SourceFile,
    absoluteFilePath: string,
    context: PatternContext,
    rule: PatternRule,
  ) => PatternViolation[]
}

/**
 * Generic path and file collection helpers.
 */
function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function toRelativeFilePath(filePath: string, rootDir = process.cwd()): string {
  return normalizeFilePath(path.relative(rootDir, filePath))
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  const relativePath = path.relative(directory, candidate)
  return relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath)
}

function shouldSkipEntry(entryPath: string): boolean {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(entryPath))
}

function matchesAnyPattern(filePath: string, patterns: RegExp[] | undefined, rootDir = process.cwd()): boolean {
  if (!patterns || patterns.length === 0) return false
  const relativePath = toRelativeFilePath(filePath, rootDir)
  return patterns.some((pattern) => pattern.test(relativePath))
}

function collectFiles(rootDir: string, includeDirs: string[]): string[] {
  const fileSet = new Set<string>()

  const walk = (dir: string) => {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory() || shouldSkipEntry(dir)) return

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)

      if (shouldSkipEntry(fullPath)) {
        continue
      }

      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }

      /* v8 ignore next -- non-file directory entries are intentionally ignored */
      if (!entry.isFile()) continue

      if (!hasExtension(fullPath, BASE_SOURCE_EXTENSIONS)) {
        continue
      }

      fileSet.add(path.resolve(fullPath))
    }
  }

  for (const includeDir of includeDirs) {
    walk(path.resolve(rootDir, includeDir))
  }

  return Array.from(fileSet).sort((a, b) => a.localeCompare(b))
}

/**
 * TypeScript parsing and module-resolution helpers.
 */
function createSourceFile(filePath: string, content: string): ts.SourceFile {
  const extension = path.extname(filePath)
  const scriptKind =
    extension === '.tsx' || extension === '.jsx' ? ts.ScriptKind.TSX :
      extension === '.js' ? ts.ScriptKind.JS :
        extension === '.mjs' ? ts.ScriptKind.JS :
          extension === '.cjs' ? ts.ScriptKind.JS :
            ts.ScriptKind.TS

  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind)
}

function readParsedConfig(tsconfigPath: string): ts.ParsedCommandLine {
  const configResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configResult.error) {
    const message = ts.flattenDiagnosticMessageText(configResult.error.messageText, '\n')
    throw new Error(`Failed to read backend tsconfig: ${message}`)
  }

  return ts.parseJsonConfigFileContent(
    configResult.config,
    ts.sys,
    path.dirname(tsconfigPath),
  )
}

function resolveImportTarget(sourceFileName: string, moduleSpecifier: string, compilerOptions: ts.CompilerOptions): string | null {
  const resolved = ts.resolveModuleName(moduleSpecifier, sourceFileName, compilerOptions, ts.sys)
  return resolved.resolvedModule?.resolvedFileName ?? null
}

function createViolation(
  sourceFile: ts.SourceFile,
  absoluteFilePath: string,
  node: ts.Node,
  rule: PatternRule,
  message: string,
  snippet?: string,
  severityOverride?: RuleSeverity,
): PatternViolation {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return {
    filePath: toRelativeFilePath(absoluteFilePath, rule.rootDir),
    line: line + 1,
    ruleId: rule.id,
    severity: severityOverride ?? rule.severity,
    message,
    snippet: snippet ?? node.getText(sourceFile),
  }
}

/**
 * AST pattern helpers used by multiple rule stages.
 */
function isProcessEnvObject(node: ts.Node | undefined): node is ts.PropertyAccessExpression {
  return !!node &&
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    node.name.text === 'env'
}

function isMongoosePropertyCall(node: ts.CallExpression, propertyName: string): boolean {
  return ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'mongoose' &&
    node.expression.name.text === propertyName
}

function isSchemaTypesMixed(node: ts.Node): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node) &&
    node.name.text === 'Mixed' &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Schema' &&
    node.expression.name.text === 'Types'
}

function unwrapTypeAssertionExpression(node: ts.Expression): ts.Expression {
  let current = node
  while (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
    current = current.expression
  }
  return current
}

function getReqValidationPropertyAccessTarget(node: ts.Expression): 'body' | 'query' | 'params' | null {
  if (ts.isPropertyAccessExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === 'req') {
      const propertyName = node.name.text
      if (propertyName === 'body' || propertyName === 'query' || propertyName === 'params') {
        return propertyName
      }
    }

    return getReqValidationPropertyAccessTarget(node.expression)
  }

  if (ts.isElementAccessExpression(node)) {
    return getReqValidationPropertyAccessTarget(node.expression)
  }

  return null
}

function isMapperFile(filePath: string, rootDir = process.cwd()): boolean {
  return /^apps\/backend\/src\/mappers\//.test(toRelativeFilePath(filePath, rootDir))
}

export function collectImportBindingIdentifiers(importClause: ts.ImportClause): ts.Identifier[] {
  const bindings: ts.Identifier[] = []

  if (importClause.name) {
    bindings.push(importClause.name)
  }

  const namedBindings = importClause.namedBindings
  if (!namedBindings) {
    return bindings
  }

  if (ts.isNamespaceImport(namedBindings)) {
    bindings.push(namedBindings.name)
    return bindings
  }

  for (const element of namedBindings.elements) {
    bindings.push(element.name)
  }

  return bindings
}

export function isTypeOnlyUsage(identifier: ts.Identifier): boolean {
  let current: ts.Node = identifier

  while (current.parent) {
    const parent = current.parent

    if (ts.isExpressionWithTypeArguments(parent) && parent.expression === current) {
      const heritageClause = parent.parent as ts.HeritageClause
      if (heritageClause.token === ts.SyntaxKind.ImplementsKeyword) {
        return true
      }

      return ts.isInterfaceDeclaration(heritageClause.parent)
    }

    if (ts.isTypeQueryNode(parent)) {
      return false
    }

    if (ts.isTypeNode(parent)) {
      return true
    }

    if (ts.isQualifiedName(parent) || ts.isPropertyAccessExpression(parent)) {
      current = parent
      continue
    }

    current = parent
  }

  return false
}

export function shouldPreferTypeImport(
  importDeclaration: ts.ImportDeclaration,
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
): boolean {
  const importClause = importDeclaration.importClause
  if (!importClause || importClause.isTypeOnly) {
    return false
  }

  const bindings = collectImportBindingIdentifiers(importClause)
  if (bindings.length === 0) {
    return false
  }

  for (const binding of bindings) {
    const bindingSymbol = typeChecker.getSymbolAtLocation(binding)
    if (!bindingSymbol) {
      return false
    }

    let foundUsage = false
    let foundRuntimeUsage = false

    const visit = (node: ts.Node) => {
      if (foundRuntimeUsage) {
        return
      }

      if (ts.isIdentifier(node) && node.text === binding.text && node !== binding) {
        const usageSymbol = typeChecker.getSymbolAtLocation(node)
        if (usageSymbol === bindingSymbol) {
          foundUsage = true
          if (!isTypeOnlyUsage(node)) {
            foundRuntimeUsage = true
            return
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)

    if (!foundUsage || foundRuntimeUsage) {
      return false
    }
  }

  return true
}

/**
 * Rule catalog.
 *
 * Read this list as a sequence of architecture-check stages. Each block below
 * exists for a specific class of production/build safety issue.
 */
export const RULES: PatternRule[] = [
  // Step 1: block the known-bad `models` named import from mongoose.
  {
    id: 'backend-mongoose-no-direct-models-import',
    severity: 'forbidden',
    summary: 'Do not import `models` directly from `mongoose`',
    rationale:
      'This named import can break at runtime under Node ESM/CommonJS interop even when type-check and build pass. Use `import mongoose, { ... } from "mongoose"` plus `mongoose.models` instead.',
    includeDirs: [],
    check(sourceFile, absoluteFilePath, _context, rule) {
      const violations: PatternViolation[] = []

      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
        if (statement.moduleSpecifier.text !== 'mongoose') continue

        const namedBindings = statement.importClause?.namedBindings
        if (!namedBindings || !ts.isNamedImports(namedBindings)) continue

        for (const element of namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text
          if (importedName !== 'models') continue

          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              element,
              rule,
              'Use o default import `mongoose` e acesse `mongoose.models` em vez de importar `models` diretamente.',
              statement.getText(sourceFile),
            ),
          )
        }
      }

      return violations
    },
  },
  // Step 2: keep new environment access centralized by default.
  {
    id: 'backend-no-direct-process-env',
    severity: 'forbidden',
    summary: 'Do not access `process.env` directly outside the allowed config/ops surface',
    rationale:
      'Direct environment reads scattered through runtime code make build-time and runtime behavior harder to reason about. New usage must stay centralized or be explicitly allowlisted.',
    includeDirs: [],
    check(sourceFile, absoluteFilePath, _context, rule) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (ts.isPropertyAccessExpression(node) && isProcessEnvObject(node.expression)) {
          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              node,
              rule,
              'Centralize environment access via config/helpers or add an explicit allowlist entry for a real operational exception.',
            ),
          )
        } else if (
          ts.isElementAccessExpression(node) &&
          isProcessEnvObject(node.expression) &&
          node.argumentExpression &&
          (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
        ) {
          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              node,
              rule,
              'Centralize environment access via config/helpers or add an explicit allowlist entry for a real operational exception.',
            ),
          )
        }

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
      return violations
    },
  },
  // Step 2.5: keep parameter objects named instead of inline in production code.
  {
    id: 'no-inline-parameter-object-types-in-production',
    severity: 'forbidden',
    summary: 'Do not use inline object type literals directly in parameter signatures',
    rationale:
      'Anonymous parameter object types increase cognitive load, duplicate shapes across layers and make shared contracts harder to evolve consistently. Prefer named Input/Dto/Params/Options/Props aliases.',
    includeDirs: [],
    check(sourceFile, absoluteFilePath, _context, rule) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (
          (ts.isFunctionDeclaration(node)
            || ts.isMethodDeclaration(node)
            || ts.isConstructorDeclaration(node)
            || ts.isArrowFunction(node)
            || ts.isFunctionExpression(node))
        ) {
          for (const parameter of node.parameters) {
            if (!parameter.type || !ts.isTypeLiteralNode(parameter.type)) continue

            violations.push(
              createViolation(
                sourceFile,
                absoluteFilePath,
                parameter.type,
                rule,
                'Extract the shape into a local or shared named type instead of keeping an inline object type in the signature.',
                parameter.getText(sourceFile),
              ),
            )
          }
        }

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
      return violations
    },
  },
  // Step 3: restrict mongoose connection lifecycle to operational/test entrypoints.
  {
    id: 'backend-mongoose-connect-only-in-ops-and-test-bootstrap',
    severity: 'forbidden',
    summary: 'Keep `mongoose.connect` and `mongoose.disconnect` out of regular runtime modules',
    rationale:
      'Connection lifecycle must stay in app bootstrap, operational scripts or dedicated test bootstrap. New runtime usage is a strong sign of layering drift.',
    includeDirs: [],
    check(sourceFile, absoluteFilePath, _context, rule) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && (isMongoosePropertyCall(node, 'connect') || isMongoosePropertyCall(node, 'disconnect'))) {
          const action = (node.expression as ts.PropertyAccessExpression).name.text
          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              node,
              rule,
              `Using \`mongoose.${action}()\` outside operational scripts or test bootstrap requires explicit architectural review.`,
            ),
          )
        }

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
      return violations
    },
  },
  // Step 4: stop runtime layers from bypassing the backend model/DAL boundary,
  // while reporting type-only mapper imports as improvement opportunities.
  {
    id: 'backend-no-direct-model-imports-outside-allowed-zones',
    severity: 'forbidden',
    summary: 'Do not import backend models directly outside model/db/tests/scripts zones',
    rationale:
      'Controllers, services, routes and middlewares should not bind directly to Mongoose models. Mappers are allowed to depend on persisted shapes, but should prefer `import type` when a model import is used only for typing.',
    includeDirs: [],
    check(sourceFile, absoluteFilePath, context, rule) {
      const violations: PatternViolation[] = []
      const mapperFile = isMapperFile(absoluteFilePath, context.rootDir)

      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue

        const targetFile = resolveImportTarget(
          absoluteFilePath,
          statement.moduleSpecifier.text,
          context.backendCompilerOptions,
        )

        if (!targetFile) continue

        if (!isInsideDirectory(context.modelsDirectory, path.resolve(targetFile))) continue

        if (mapperFile) {
          if (shouldPreferTypeImport(statement, sourceFile, context.backendTypeChecker)) {
            violations.push(
              createViolation(
                sourceFile,
                absoluteFilePath,
                statement,
                rule,
                'This mapper appears to use the model import only for typing. Prefer `import type` to avoid unnecessary runtime coupling.',
                undefined,
                'undesirable',
              ),
            )
          }

          continue
        }

        violations.push(
          createViolation(
            sourceFile,
            absoluteFilePath,
            statement,
            rule,
            'Do not import backend models directly in this layer. Use the DAL or move the dependency to an explicitly authorized zone.',
          ),
        )
      }

      return violations
    },
  },
  // Step 5: restrict dynamic mongoose model lookup/registration to narrow zones.
  {
    id: 'backend-mongoose-model-only-in-model-layer-or-allowlist',
    severity: 'forbidden',
    summary: 'Do not call `mongoose.model(...)` outside the model layer or explicit exceptions',
    rationale:
      'Dynamic model lookup/registration outside the model layer is hard to reason about and can hide coupling to Mongoose internals. Exceptions must stay narrow and explicit.',
    includeDirs: [],
    check(sourceFile, absoluteFilePath, _context, rule) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && isMongoosePropertyCall(node, 'model')) {
          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              node,
              rule,
              'Restrict `mongoose.model(...)` to models, tests, or explicitly authorized operational exceptions.',
            ),
          )
        }

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
      return violations
    },
  },
  // Step 6: flag destructive bulk operations outside tests and maintenance flows.
  {
    id: 'backend-no-destructive-bulk-ops-outside-tests-and-maintenance',
    severity: 'forbidden',
    summary: 'Keep destructive bulk operations out of regular runtime code',
    rationale:
      'Operations like `deleteMany({})`, `dropDatabase()` and `dropCollection()` are valid in tests and very specific maintenance flows, but dangerous as a casual pattern elsewhere.',
    includeDirs: [],
    check(sourceFile, absoluteFilePath, _context, rule) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
          ts.forEachChild(node, visit)
          return
        }

        const methodName = node.expression.name.text
        if (methodName === 'deleteMany') {
          const [firstArg] = node.arguments
          if (firstArg && ts.isObjectLiteralExpression(firstArg) && firstArg.properties.length === 0) {
            violations.push(
              createViolation(
                sourceFile,
                absoluteFilePath,
                node,
                rule,
                'Bulk destructive cleanup with `deleteMany({})` must exist only in tests or explicitly authorized maintenance flows.',
              ),
            )
          }
        } else if (methodName === 'dropDatabase' || methodName === 'dropCollection') {
          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              node,
              rule,
              `Destructive operation \`${methodName}()\` must exist only in tests or explicitly authorized maintenance flows.`,
            ),
          )
        }

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
      return violations
    },
  },
  // Step 7: prevent new flexible-schema escape hatches without explicit review.
  {
    id: 'backend-no-new-schema-mixed-usage',
    severity: 'forbidden',
    summary: 'Do not introduce new `Schema.Types.Mixed` usage outside the explicit allowlist',
    rationale:
      'Mixed weakens schema guarantees and should stay limited to the few places where the current system intentionally accepts flexible payloads.',
    includeDirs: [],
    check(sourceFile, absoluteFilePath, _context, rule) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (isSchemaTypesMixed(node)) {
          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              node,
              rule,
              'New `Schema.Types.Mixed` usage requires architectural review and an explicit allowlist entry.',
            ),
          )
        }

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
      return violations
    },
  },
  // Step 8: keep Express controllers typed from route validation instead of request casts.
  {
    id: 'backend-controllers-no-validated-request-casts',
    severity: 'forbidden',
    summary: 'Do not cast `req.body`, `req.query` or `req.params` inside controllers',
    rationale:
      'Controllers should receive typed request shapes from validation middleware via `handleAsync<TRequest>`, keeping validation and type inference aligned at the route boundary.',
    includeDirs: [],
    check(sourceFile, absoluteFilePath, _context, rule) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (ts.isAsExpression(node)) {
          const parent = node.parent
          if (!ts.isAsExpression(parent)) {
            const target = getReqValidationPropertyAccessTarget(unwrapTypeAssertionExpression(node.expression))
            if (target) {
              violations.push(
                createViolation(
                  sourceFile,
                  absoluteFilePath,
                  node,
                  rule,
                  `The \`req.${target}\` type must come from \`handleAsync<TRequest>\` using RequestFromSchemas/ValidatedRequest, without a manual controller cast.`,
                ),
              )
            }
          }
        }

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
      return violations
    },
  },
  {
    id: 'frontend-no-direct-axios-imports-outside-http-boundary',
    severity: 'forbidden',
    summary: 'Do not import `axios` directly outside the shared HTTP boundary',
    rationale:
      'Axios-specific knowledge should stay inside the shared transport boundary so apps and UI code depend on canonical contract clients and generic error helpers instead of transport details.',
    includeDirs: [],
    check(sourceFile, absoluteFilePath, _context, rule) {
      const violations: PatternViolation[] = []

      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
        if (statement.moduleSpecifier.text !== 'axios') continue

        violations.push(
          createViolation(
            sourceFile,
            absoluteFilePath,
            statement,
            rule,
            'Import shared helpers or clients instead of using `axios` directly outside the HTTP boundary.',
          ),
        )
      }

      return violations
    },
  },
  {
    id: 'frontend-no-services-api-imports-outside-shared-service-boundary',
    severity: 'forbidden',
    summary: 'Keep `services/api/*` imports inside the shared service boundary',
    rationale:
      'The internal `services/api/*` transport/config surface should not leak into apps or shared UI modules. Only the shared service layer and explicit test helpers may depend on it directly.',
    includeDirs: [],
    check(sourceFile, absoluteFilePath, _context, rule) {
      const violations: PatternViolation[] = []

      for (const statement of sourceFile.statements) {
        const moduleSpecifier =
          ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
            ? statement.moduleSpecifier
            : undefined

        if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) continue
        if (!moduleSpecifier.text.includes('services/api/')) continue

        violations.push(
          createViolation(
            sourceFile,
            absoluteFilePath,
            statement,
            rule,
            'Use the shared public API instead of importing `services/api/*` outside the service boundary.',
          ),
        )
      }

      return violations
    },
  },
]

/**
 * Output helpers and main execution flow.
 */
function printHeader(): void {
  console.log(`${colors.bright}${colors.blue}Code Pattern Guard${colors.reset}`)
  console.log(`${colors.gray}Detects forbidden or undesirable code patterns outside the ideal scope of global linting.${colors.reset}`)
  console.log()
}

export async function runCodePatternGuard(options: {
  rootDir?: string
  config?: CodePatternGuardConfig
} = {}): Promise<number> {
  const rootDir = options.rootDir ?? process.cwd()
  const config = options.config ?? await loadGuardConfig('codePattern', rootDir)
  const availableRuleIds = new Set(RULES.map((rule) => rule.id))
  const configuredRuleIds = Object.keys(config.rules)
  const unknownRuleIds = configuredRuleIds.filter((ruleId) => !availableRuleIds.has(ruleId))
  /* v8 ignore next -- both outcomes are asserted; V8 omits the fallthrough branch */
  if (unknownRuleIds.length > 0) {
    throw new Error(`Unknown code-pattern rule(s): ${unknownRuleIds.join(', ')}`)
  }
  if (configuredRuleIds.length === 0) {
    throw new Error('guards.codePattern.rules must not be empty.')
  }

  const rules = RULES
    .filter((rule) => config.rules[rule.id])
    .map((rule) => ({
      ...rule,
      rootDir,
      includeDirs: config.rules[rule.id].includePaths,
      allowedPathPatterns: compilePatterns(config.rules[rule.id].allowedPathPatterns),
    }))
  for (const includeDir of rules.flatMap((rule) => rule.includeDirs)) resolveProjectPath(rootDir, includeDir)
  printHeader()

  const parsedBackendConfig = readParsedConfig(resolveProjectPath(rootDir, config.tsconfig))
  const backendProgram = ts.createProgram(parsedBackendConfig.fileNames, parsedBackendConfig.options)
  const context: PatternContext = {
    rootDir,
    backendProgram,
    backendTypeChecker: backendProgram.getTypeChecker(),
    backendCompilerOptions: parsedBackendConfig.options,
    modelsDirectory: resolveProjectPath(rootDir, config.modelsDirectory),
  }

  const allIncludeDirs = Array.from(new Set(rules.flatMap((rule) => rule.includeDirs)))
  console.log(`${colors.cyan}Rules loaded:${colors.reset} ${rules.length}`)
  console.log(`${colors.cyan}Scope:${colors.reset} ${allIncludeDirs.join(', ')}`)
  console.log()

  const files = collectFiles(rootDir, allIncludeDirs)
  for (const rule of rules) {
    const eligibleFiles = files.filter((filePath) => rule.includeDirs.some((includeDir) => (
      isInsideDirectory(path.resolve(rootDir, includeDir), filePath)
    )))
    assertConfiguredScanScope({
      root: rootDir,
      guardName: 'code-pattern',
      configPath: `guards.codePattern.rules.${rule.id}.includePaths`,
      configuredPaths: rule.includeDirs,
      eligibleFiles,
    })
  }
  const violations: PatternViolation[] = []

  for (const filePath of files) {
    const sourceFile = context.backendProgram.getSourceFile(filePath) ?? createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'))

    for (const rule of rules) {
      const isInScope = rule.includeDirs.some((includeDir) => {
        const absoluteIncludeDir = path.resolve(rootDir, includeDir)
        return normalizeFilePath(filePath).startsWith(normalizeFilePath(absoluteIncludeDir))
      })

      if (!isInScope) continue
      if (matchesAnyPattern(filePath, rule.allowedPathPatterns, rootDir)) continue

      violations.push(...rule.check(sourceFile, filePath, context, rule))
    }
  }

  if (violations.length === 0) {
    console.log(`${colors.green}${colors.bright}No prohibited or undesirable code patterns found.${colors.reset}`)
    console.log()
    return 0
  }

  const byRule = new Map<string, PatternViolation[]>()
  for (const violation of violations) {
    const list = byRule.get(violation.ruleId) ?? []
    list.push(violation)
    byRule.set(violation.ruleId, list)
  }

  const hasForbiddenViolations = violations.some((violation) => violation.severity === 'forbidden')
  const headingColor = hasForbiddenViolations ? colors.red : colors.yellow
  const headingLabel = hasForbiddenViolations ? 'Violations found' : 'Improvement opportunities found'

  console.log(`${colors.bright}${headingColor}${headingLabel}${colors.reset}`)
  console.log(`${colors.gray}Each item below represents a pattern that must be fixed or explicitly reassessed.${colors.reset}`)
  console.log()

  for (const rule of rules) {
    const matches = byRule.get(rule.id) ?? []
    if (matches.length === 0) continue

    const ruleHasForbidden = matches.some((match) => match.severity === 'forbidden')
    const ruleSeverityLabel = ruleHasForbidden ? 'forbidden' : 'undesirable'

    console.log(`${colors.bright}${rule.id}${colors.reset} (${matches.length})`)
    console.log(`- Severity: ${ruleSeverityLabel}`)
    console.log(`- Summary: ${rule.summary}`)
    console.log(`- Rationale: ${rule.rationale}`)

    for (const violation of matches) {
      console.log(`  ${colors.gray}${violation.filePath}:${violation.line}${colors.reset}`)
      console.log(`    ${colors.red}->${colors.reset} ${violation.message}`)
      console.log(`    ${colors.gray}${violation.snippet}${colors.reset}`)
    }

    console.log()
  }

  return hasForbiddenViolations ? 1 : 0
}

/* v8 ignore start -- executable adapter */
if (isMainModule(import.meta.url)) {
  runCodePatternGuard().then((code) => {
    process.exitCode = code
  }).catch((error: unknown) => {
    console.error((error as Error).message)
    process.exitCode = 1
  })
}
/* v8 ignore stop */
