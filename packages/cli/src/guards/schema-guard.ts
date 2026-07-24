import fs from 'node:fs'
import path from 'node:path'
import {
  Node,
  Project,
  SyntaxKind,
  type Expression,
  type Node as MorphNode,
} from 'ts-morph'
import type { SchemaGuardConfig } from '../config.js'
import {
  BASE_SOURCE_EXCLUDE_PATTERNS,
  BASE_SOURCE_EXTENSIONS,
  assertConfiguredScanScope,
  compilePatterns,
  hasExtension,
  isMainModule,
  loadGuardConfig,
  resolveProjectPath,
} from './guard-config.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
}

type SchemaViolation = {
  filePath: string
  line: number
  snippet: string
}

type DefinitionCandidate = {
  owner: MorphNode
  expression: Expression
}

function isWithinDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..')
}

function normalizedRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replaceAll('\\', '/')
}

function collectFiles(
  rootDir: string,
  config: SchemaGuardConfig,
  centralDirectory: string,
  excludePatterns: RegExp[],
): string[] {
  const files: string[] = []

  function walk(directory: string): void {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return
    if (isWithinDirectory(directory, centralDirectory)) return

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      const relativePath = normalizedRelativePath(rootDir, fullPath)
      if (entry.isDirectory()) {
        if (!excludePatterns.some((pattern) => pattern.test(relativePath))) walk(fullPath)
      } else if (
        entry.isFile() &&
        hasExtension(fullPath, BASE_SOURCE_EXTENSIONS) &&
        !excludePatterns.some((pattern) => pattern.test(relativePath))
      ) {
        files.push(fullPath)
      }
    }
  }

  for (const includePath of config.includePaths) {
    walk(resolveProjectPath(rootDir, includePath))
  }
  return files.sort()
}

function unwrapExpression(expression: Expression): Expression {
  if (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isTypeAssertion(expression) ||
    Node.isSatisfiesExpression(expression) ||
    Node.isNonNullExpression(expression)
  ) {
    return unwrapExpression(expression.getExpression())
  }
  return expression
}

function findRootBuilder(expression: Expression, builders: Set<string>): string | null {
  const current = unwrapExpression(expression)
  if (!Node.isCallExpression(current)) return null

  const callee = unwrapExpression(current.getExpression())
  if (!Node.isPropertyAccessExpression(callee)) return null

  const target = unwrapExpression(callee.getExpression())
  if (Node.isIdentifier(target) && target.getText() === 'z' && builders.has(callee.getName())) {
    return callee.getName()
  }
  return findRootBuilder(target, builders)
}

function definitionCandidate(node: MorphNode): DefinitionCandidate | null {
  if (Node.isVariableDeclaration(node) || Node.isPropertyDeclaration(node) || Node.isPropertyAssignment(node)) {
    const expression = node.getInitializer()
    return expression ? { owner: node, expression } : null
  }
  if (Node.isExportAssignment(node)) {
    return { owner: node, expression: node.getExpression() }
  }
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
    return { owner: node, expression: node.getRight() }
  }
  return null
}

function isNestedInDefinition(candidate: DefinitionCandidate, outer: DefinitionCandidate): boolean {
  if (
    candidate.expression.getStart() <= outer.expression.getStart() ||
    candidate.expression.getEnd() > outer.expression.getEnd()
  ) {
    return false
  }

  for (const ancestor of candidate.expression.getAncestors()) {
    if (ancestor === outer.expression) return true
    if (ancestor !== candidate.owner && Node.isFunctionLikeDeclaration(ancestor)) return false
  }
  /* v8 ignore next -- a contained ts-morph descendant always reaches the containing expression */
  return false
}

export function findSchemaDefinitions(
  filePath: string,
  project: Project,
  configuredBuilders: string[],
): Array<{ line: number; snippet: string }> {
  const sourceFile = project.addSourceFileAtPath(filePath)
  const builders = new Set(configuredBuilders)
  const candidates: DefinitionCandidate[] = []

  sourceFile.forEachDescendant((node) => {
    const candidate = definitionCandidate(node)
    if (candidate && findRootBuilder(candidate.expression, builders)) candidates.push(candidate)
  })

  return candidates
    .filter((candidate) => !candidates.some((outer) => (
      outer !== candidate && isNestedInDefinition(candidate, outer)
    )))
    .map((candidate) => ({
      line: candidate.expression.getStartLineNumber(),
      snippet: candidate.expression.getText().replace(/\s+/gu, ' ').slice(0, 120),
    }))
}

export async function runSchemaGuard(options: {
  rootDir?: string
  config?: SchemaGuardConfig
} = {}): Promise<number> {
  const rootDir = options.rootDir ?? process.cwd()
  const config = options.config ?? await loadGuardConfig('schema', rootDir)
  /* v8 ignore next -- every invalid operand and the valid fallthrough are asserted */
  if (!config.centralDirectory || config.includePaths.length === 0 || config.builders.length === 0) {
    throw new Error('guards.schema requires centralDirectory, non-empty includePaths, and non-empty builders.')
  }
  const excludePatterns = compilePatterns(config.excludePatterns, BASE_SOURCE_EXCLUDE_PATTERNS)
  const centralDirectory = resolveProjectPath(rootDir, config.centralDirectory)
  const files = collectFiles(rootDir, config, centralDirectory, excludePatterns)

  assertConfiguredScanScope({
    root: rootDir,
    guardName: 'schema',
    configPath: 'guards.schema.includePaths',
    configuredPaths: config.includePaths,
    eligibleFiles: files,
  })

  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const violations: SchemaViolation[] = []
  for (const filePath of files) {
    for (const definition of findSchemaDefinitions(filePath, project, config.builders)) {
      violations.push({
        filePath: normalizedRelativePath(rootDir, filePath),
        ...definition,
      })
    }
  }

  if (violations.length === 0) {
    console.info(`${colors.green}${colors.bright}✅ [OK]${colors.reset} No configured schema builders found outside ${config.centralDirectory}.`)
    return 0
  }

  console.error(`${colors.bright}${colors.yellow}Configured schemas found outside ${config.centralDirectory}:${colors.reset}`)
  for (const violation of violations) {
    console.error(`${colors.gray}${violation.filePath}:${violation.line}${colors.reset} ${violation.snippet}`)
  }
  console.error(`${colors.red}Move these definitions to ${config.centralDirectory}.${colors.reset}`)
  return 1
}

/* v8 ignore start -- executable adapter */
if (isMainModule(import.meta.url)) {
  runSchemaGuard().then((code) => {
    process.exitCode = code
  }).catch((error: unknown) => {
    console.error((error as Error).message)
    process.exitCode = 1
  })
}
/* v8 ignore stop */
