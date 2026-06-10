#!/usr/bin/env tsx
// @ts-nocheck
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
const ROOT_DIR = process.cwd()
const BACKEND_TS_CONFIG = path.resolve(ROOT_DIR, 'apps/backend/tsconfig.json')
const BACKEND_MODELS_DIR = normalizeFilePath(path.resolve(ROOT_DIR, 'apps/backend/src/models'))

/**
 * Generic file-system exclusions for this guard.
 */
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /dist/,
  /build/,
  /coverage/,
]

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
  backendProgram: ts.Program
  backendTypeChecker: ts.TypeChecker
  backendCompilerOptions: ts.CompilerOptions
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
  check: (sourceFile: ts.SourceFile, absoluteFilePath: string, context: PatternContext) => PatternViolation[]
}

/**
 * Generic path and file collection helpers.
 */
function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function toRelativeFilePath(filePath: string): string {
  return normalizeFilePath(path.relative(ROOT_DIR, filePath))
}

function shouldSkipEntry(entryPath: string): boolean {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(entryPath))
}

function matchesAnyPattern(filePath: string, patterns: RegExp[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false
  const relativePath = toRelativeFilePath(filePath)
  return patterns.some((pattern) => pattern.test(relativePath))
}

function collectFiles(includeDirs: string[]): string[] {
  const fileSet = new Set<string>()

  const walk = (dir: string) => {
    if (!fs.existsSync(dir) || shouldSkipEntry(dir)) return

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)

      if (shouldSkipEntry(fullPath)) {
        continue
      }

      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      if (!fullPath.match(/\.(ts|tsx|js|mjs|cjs)$/)) {
        continue
      }

      fileSet.add(path.resolve(fullPath))
    }
  }

  for (const includeDir of includeDirs) {
    walk(path.resolve(ROOT_DIR, includeDir))
  }

  return Array.from(fileSet).sort((a, b) => a.localeCompare(b))
}

/**
 * TypeScript parsing and module-resolution helpers.
 */
function createSourceFile(filePath: string, content: string): ts.SourceFile {
  const extension = path.extname(filePath)
  const scriptKind =
    extension === '.tsx' ? ts.ScriptKind.TSX :
      extension === '.js' ? ts.ScriptKind.JS :
        extension === '.mjs' ? ts.ScriptKind.JS :
          extension === '.cjs' ? ts.ScriptKind.JS :
            ts.ScriptKind.TS

  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind)
}

function readBackendParsedConfig(): ts.ParsedCommandLine {
  const configResult = ts.readConfigFile(BACKEND_TS_CONFIG, ts.sys.readFile)
  if (configResult.error) {
    const message = ts.flattenDiagnosticMessageText(configResult.error.messageText, '\n')
    throw new Error(`Failed to read backend tsconfig: ${message}`)
  }

  return ts.parseJsonConfigFileContent(
    configResult.config,
    ts.sys,
    path.dirname(BACKEND_TS_CONFIG),
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
    filePath: toRelativeFilePath(absoluteFilePath),
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

function isMapperFile(filePath: string): boolean {
  return /^apps\/backend\/src\/mappers\//.test(toRelativeFilePath(filePath))
}

function collectImportBindingIdentifiers(importClause: ts.ImportClause): ts.Identifier[] {
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

function isTypeOnlyUsage(identifier: ts.Identifier): boolean {
  let current: ts.Node = identifier

  while (current.parent) {
    const parent = current.parent

    if (ts.isTypeNode(parent)) {
      return true
    }

    if (ts.isExpressionWithTypeArguments(parent) && parent.expression === current) {
      const heritageClause = parent.parent
      if (!ts.isHeritageClause(heritageClause)) {
        return false
      }

      if (heritageClause.token === ts.SyntaxKind.ImplementsKeyword) {
        return true
      }

      return ts.isInterfaceDeclaration(heritageClause.parent)
    }

    if (ts.isTypeQueryNode(parent)) {
      return false
    }

    if (ts.isQualifiedName(parent) || ts.isPropertyAccessExpression(parent)) {
      current = parent
      continue
    }

    current = parent
  }

  return false
}

function shouldPreferTypeImport(
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
 * Current-state allowlists.
 *
 * These are not "style exceptions". They document places that are currently
 * accepted by the healthy system and should not fail the architecture check
 * unless we explicitly decide to tighten the policy later.
 */
const ALLOW_PROCESS_ENV_PATHS = [
  /^apps\/backend\/src\/config\.ts$/,
  /^apps\/backend\/src\/setup-env\.ts$/,
  /^apps\/backend\/src\/instrument\.ts$/,
  /^apps\/backend\/src\/controllers\/utils\/responses\.utils\.ts$/,
  /^apps\/backend\/src\/middlewares\/network-lag\.middleware\.ts$/,
  /^apps\/backend\/src\/services\/diagnostics\/health\.service\.ts$/,
  /^apps\/backend\/src\/services\/notifications\/config-loader\.service\.ts$/,
  /^apps\/backend\/src\/services\/notifications\/email-providers-pool\.service\.ts$/,
  /^apps\/backend\/src\/services\/notifications\/email\.service\.ts$/,
  /^apps\/backend\/src\/services\/notifications\/notifier\.service\.ts$/,
  /^apps\/backend\/src\/services\/notifications\/sms\.service\.ts$/,
  /^apps\/backend\/src\/services\/notifications\/sms\/providers\/comtele\.provider\.ts$/,
  /^apps\/backend\/src\/.*\.(test|spec)\.ts$/,
  /^apps\/backend\/scripts\/diagnostics\/db-integrity-report\.ts$/,
  /^apps\/backend\/scripts\/diagnostics\/smart-search-diagnostics\.ts$/,
  /^apps\/backend\/tests\//,
]

const ALLOW_MONGOOSE_CONNECT_PATHS = [
  /^apps\/backend\/src\/index\.ts$/,
  /^apps\/backend\/scripts\//,
  /^apps\/backend\/tests\/global-mongo-setup\.ts$/,
]

const ALLOW_DIRECT_MODEL_IMPORT_SOURCE_PATHS = [
  /^apps\/backend\/src\/db\//,
  /^apps\/backend\/src\/models\//,
  /^apps\/backend\/src\/.*\.(test|spec)\.ts$/,
  /^apps\/backend\/scripts\//,
  /^apps\/backend\/tests\//,
]

const ALLOW_MONGOOSE_MODEL_PATHS = [
  /^apps\/backend\/src\/models\//,
  /^apps\/backend\/src\/.*\.(test|spec)\.ts$/,
  /^apps\/backend\/tests\//,
  /^apps\/backend\/scripts\/diagnostics\/db-integrity-report\.ts$/,
]

const ALLOW_DESTRUCTIVE_BULK_OPS_PATHS = [
  /^apps\/backend\/src\/.*\.(test|spec)\.ts$/,
  /^apps\/backend\/tests\//,
  /^apps\/backend\/src\/services\/maintenance\/maintenance\.database-copy\.ts$/,
  /^apps\/backend\/scripts\/backfill\/drop-operational-monitor-collections-once\.ts$/,
]

const ALLOW_SCHEMA_MIXED_PATHS = [
  /^apps\/backend\/src\/models\/notification\/notification\.schemas\.ts$/,
  /^apps\/backend\/src\/models\/log\/log\.schemas\.ts$/,
]

const ALLOW_INLINE_PARAMETER_OBJECT_PATHS = [
  /^apps\/backend\/src\/.*\.(test|spec)\.ts$/,
  /^apps\/backend\/src\/test\//,
  /^apps\/frontend-user\/src\/.*\.(test|spec)\.tsx?$/,
  /^apps\/frontend-admin\/src\/.*\.(test|spec)\.tsx?$/,
  /^apps\/maintenance\/src\/.*\.(test|spec)\.tsx?$/,
  /^packages\/core\/src\/.*\.(test|spec)\.ts$/,
  /^packages\/frontend-shared\/src\/.*\.(test|spec)\.tsx?$/,
  /^packages\/frontend-shared\/src\/test\//,
  /^packages\/shared-logic\/src\/.*\.(test|spec)\.ts$/,
  /^packages\/testing\//,
]

const ALLOW_DIRECT_AXIOS_IMPORT_PATHS = [
  /^apps\/frontend-user\/src\/.*\.(test|spec)\.tsx?$/,
  /^apps\/frontend-admin\/src\/.*\.(test|spec)\.tsx?$/,
  /^packages\/frontend-shared\/src\/services\/api\//,
  /^packages\/frontend-shared\/src\/services\/contracts\/http-contract-client\.ts$/,
  /^packages\/frontend-shared\/src\/.*\.(test|spec)\.tsx?$/,
  /^packages\/frontend-shared\/src\/.*\.(test|spec)\.ts$/,
  /^packages\/frontend-shared\/src\/test\//,
]

const ALLOW_SHARED_SERVICES_API_IMPORT_PATHS = [
  /^packages\/frontend-shared\/src\/services\//,
  /^packages\/frontend-shared\/src\/.*\.(test|spec)\.tsx?$/,
  /^packages\/frontend-shared\/src\/.*\.(test|spec)\.ts$/,
  /^packages\/frontend-shared\/src\/test\//,
]

/**
 * Rule catalog.
 *
 * Read this list as a sequence of architecture-check stages. Each block below
 * exists for a specific class of production/build safety issue.
 */
const RULES: PatternRule[] = [
  // Step 1: block the known-bad `models` named import from mongoose.
  {
    id: 'backend-mongoose-no-direct-models-import',
    severity: 'forbidden',
    summary: 'Do not import `models` directly from `mongoose`',
    rationale:
      'This named import can break at runtime under Node ESM/CommonJS interop even when type-check and build pass. Use `import mongoose, { ... } from "mongoose"` plus `mongoose.models` instead.',
    includeDirs: ['apps/backend/src', 'apps/backend/scripts', 'apps/backend/tests'],
    check(sourceFile, absoluteFilePath, _context) {
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
              RULES[0],
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
    includeDirs: ['apps/backend/src', 'apps/backend/scripts', 'apps/backend/tests'],
    allowedPathPatterns: ALLOW_PROCESS_ENV_PATHS,
    check(sourceFile, absoluteFilePath, _context) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (ts.isPropertyAccessExpression(node) && isProcessEnvObject(node.expression)) {
          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              node,
              RULES[1],
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
              RULES[1],
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
    includeDirs: [
      'apps/backend/src',
      'apps/frontend-user/src',
      'apps/frontend-admin/src',
      'apps/maintenance/src',
      'packages/core/src',
      'packages/frontend-shared/src',
      'packages/shared-logic/src',
      'configs/frontend',
    ],
    allowedPathPatterns: ALLOW_INLINE_PARAMETER_OBJECT_PATHS,
    check(sourceFile, absoluteFilePath, _context) {
      const violations: PatternViolation[] = []
      const rule = RULES.find((candidate) => candidate.id === 'no-inline-parameter-object-types-in-production')
      if (!rule) {
        throw new Error('Inline parameter object guard rule not found.')
      }

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
                'Extraia o shape para um tipo nomeado local ou compartilhado em vez de manter um object type inline na assinatura.',
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
    includeDirs: ['apps/backend/src', 'apps/backend/scripts', 'apps/backend/tests'],
    allowedPathPatterns: ALLOW_MONGOOSE_CONNECT_PATHS,
    check(sourceFile, absoluteFilePath, _context) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && (isMongoosePropertyCall(node, 'connect') || isMongoosePropertyCall(node, 'disconnect'))) {
          const action = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : 'connect'
          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              node,
              RULES[2],
              `Use de \`mongoose.${action}()\` fora de scripts operacionais ou bootstrap de teste precisa de revisao arquitetural explicita.`,
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
    includeDirs: ['apps/backend/src', 'apps/backend/scripts', 'apps/backend/tests'],
    allowedPathPatterns: ALLOW_DIRECT_MODEL_IMPORT_SOURCE_PATHS,
    check(sourceFile, absoluteFilePath, context) {
      const violations: PatternViolation[] = []
      const mapperFile = isMapperFile(absoluteFilePath)

      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue

        const targetFile = resolveImportTarget(
          absoluteFilePath,
          statement.moduleSpecifier.text,
          context.backendCompilerOptions,
        )

        if (!targetFile) continue

        const normalizedTarget = normalizeFilePath(path.resolve(targetFile))
        if (!normalizedTarget.startsWith(BACKEND_MODELS_DIR)) continue

        if (mapperFile) {
          if (shouldPreferTypeImport(statement, sourceFile, context.backendTypeChecker)) {
            violations.push(
              createViolation(
                sourceFile,
                absoluteFilePath,
                statement,
                RULES[3],
                'Neste mapper, o import do model parece ser usado apenas para tipagem. Prefira `import type` para evitar acoplamento de runtime desnecessario.',
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
            RULES[3],
            'Nao importe models do backend diretamente nesta camada. Passe pelo DAL ou mova a necessidade para uma zona explicitamente autorizada.',
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
    includeDirs: ['apps/backend/src', 'apps/backend/scripts', 'apps/backend/tests'],
    allowedPathPatterns: ALLOW_MONGOOSE_MODEL_PATHS,
    check(sourceFile, absoluteFilePath, _context) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && isMongoosePropertyCall(node, 'model')) {
          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              node,
              RULES[4],
              'Restrinja `mongoose.model(...)` a models, testes ou excecoes operacionais explicitamente autorizadas.',
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
    includeDirs: ['apps/backend/src', 'apps/backend/scripts', 'apps/backend/tests'],
    allowedPathPatterns: ALLOW_DESTRUCTIVE_BULK_OPS_PATHS,
    check(sourceFile, absoluteFilePath, _context) {
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
                RULES[5],
                'Bulk destructive cleanup com `deleteMany({})` so deve existir em testes ou manutenção explicitamente autorizada.',
              ),
            )
          }
        } else if (methodName === 'dropDatabase' || methodName === 'dropCollection') {
          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              node,
              RULES[5],
              `Operação destrutiva \`${methodName}()\` so deve existir em testes ou manutenção explicitamente autorizada.`,
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
    includeDirs: ['apps/backend/src', 'apps/backend/scripts', 'apps/backend/tests'],
    allowedPathPatterns: ALLOW_SCHEMA_MIXED_PATHS,
    check(sourceFile, absoluteFilePath, _context) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (isSchemaTypesMixed(node)) {
          violations.push(
            createViolation(
              sourceFile,
              absoluteFilePath,
              node,
              RULES[6],
              'Novo uso de `Schema.Types.Mixed` exige revisao arquitetural e allowlist explicita.',
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
    includeDirs: ['apps/backend/src/controllers'],
    check(sourceFile, absoluteFilePath, _context) {
      const violations: PatternViolation[] = []

      const visit = (node: ts.Node) => {
        if (ts.isAsExpression(node)) {
          const parent = node.parent
          if (!parent || !ts.isAsExpression(parent)) {
            const target = getReqValidationPropertyAccessTarget(unwrapTypeAssertionExpression(node.expression))
            if (target) {
              violations.push(
                createViolation(
                  sourceFile,
                  absoluteFilePath,
                  node,
                  RULES[7],
                  `Tipo de \`req.${target}\` deve vir de \`handleAsync<TRequest>\` usando RequestFromSchemas/ValidatedRequest, sem cast manual no controller.`,
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
    includeDirs: ['apps/frontend-user/src', 'apps/frontend-admin/src', 'packages/frontend-shared/src'],
    allowedPathPatterns: ALLOW_DIRECT_AXIOS_IMPORT_PATHS,
    check(sourceFile, absoluteFilePath, _context) {
      const violations: PatternViolation[] = []
      const rule = RULES.find((candidate) => candidate.id === 'frontend-no-direct-axios-imports-outside-http-boundary')
      if (!rule) {
        throw new Error('Direct axios import guard rule not found.')
      }

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
            'Importe helpers/clients compartilhados em vez de usar `axios` diretamente fora do boundary HTTP.',
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
    includeDirs: ['apps/frontend-user/src', 'apps/frontend-admin/src', 'packages/frontend-shared/src'],
    allowedPathPatterns: ALLOW_SHARED_SERVICES_API_IMPORT_PATHS,
    check(sourceFile, absoluteFilePath, _context) {
      const violations: PatternViolation[] = []
      const rule = RULES.find((candidate) => candidate.id === 'frontend-no-services-api-imports-outside-shared-service-boundary')
      if (!rule) {
        throw new Error('services/api boundary guard rule not found.')
      }

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
            'Consuma a API publica compartilhada em vez de importar `services/api/*` fora do boundary de services.',
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
  console.log(`${colors.gray}Detecta padroes de codigo proibidos ou indesejados fora do escopo ideal do lint global.${colors.reset}`)
  console.log()
}

function main(): void {
  printHeader()

  const parsedBackendConfig = readBackendParsedConfig()
  const backendProgram = ts.createProgram(parsedBackendConfig.fileNames, parsedBackendConfig.options)
  const context: PatternContext = {
    backendProgram,
    backendTypeChecker: backendProgram.getTypeChecker(),
    backendCompilerOptions: parsedBackendConfig.options,
  }

  const allIncludeDirs = Array.from(new Set(RULES.flatMap((rule) => rule.includeDirs)))
  console.log(`${colors.cyan}Rules loaded:${colors.reset} ${RULES.length}`)
  console.log(`${colors.cyan}Scope:${colors.reset} ${allIncludeDirs.join(', ')}`)
  console.log()

  const files = collectFiles(allIncludeDirs)
  const violations: PatternViolation[] = []

  for (const filePath of files) {
    const sourceFile = context.backendProgram.getSourceFile(filePath) ?? createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'))

    for (const rule of RULES) {
      const isInScope = rule.includeDirs.some((includeDir) => {
        const absoluteIncludeDir = path.resolve(ROOT_DIR, includeDir)
        return normalizeFilePath(filePath).startsWith(normalizeFilePath(absoluteIncludeDir))
      })

      if (!isInScope) continue
      if (matchesAnyPattern(filePath, rule.allowedPathPatterns)) continue

      violations.push(...rule.check(sourceFile, filePath, context))
    }
  }

  if (violations.length === 0) {
    console.log(`${colors.green}${colors.bright}No prohibited or undesirable code patterns found.${colors.reset}`)
    console.log()
    process.exit(0)
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
  console.log(`${colors.gray}Cada item abaixo representa um padrao que deve ser corrigido ou explicitamente reavaliado.${colors.reset}`)
  console.log()

  for (const rule of RULES) {
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

  process.exit(hasForbiddenViolations ? 1 : 0)
}

main()
