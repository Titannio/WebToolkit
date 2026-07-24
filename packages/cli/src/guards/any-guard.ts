import fs from 'node:fs'
import path from 'node:path'
import { Node, Project, SyntaxKind, type Node as MorphNode } from 'ts-morph'
import type { AnyGuardConfig } from '../config.js'
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
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

export type AnyOccurrence = {
  line: number
  column: number
  context: string
}

export type AnyFileReport = {
  filePath: string
  occurrences: AnyOccurrence[]
}

function normalizedRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replaceAll('\\', '/')
}

function isExcluded(rootDir: string, filePath: string, patterns: RegExp[]): boolean {
  const relativePath = normalizedRelativePath(rootDir, filePath)
  return patterns.some((pattern) => pattern.test(relativePath))
}

function collectFiles(rootDir: string, config: AnyGuardConfig, excludePatterns: RegExp[]): string[] {
  const files: string[] = []

  function walk(directory: string): void {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!isExcluded(rootDir, fullPath, excludePatterns)) walk(fullPath)
      } else if (
        entry.isFile() &&
        hasExtension(fullPath, BASE_SOURCE_EXTENSIONS) &&
        !isExcluded(rootDir, fullPath, excludePatterns)
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

function isInsideJsDoc(node: MorphNode): boolean {
  return node.getAncestors().some((ancestor) => ancestor.getKindName().startsWith('JSDoc'))
}

function isAllowed(node: MorphNode): boolean {
  for (const ancestor of node.getAncestors()) {
    if (Node.isJSDocable(ancestor)) {
      return ancestor.getJsDocs().some((doc) => doc.getText().includes('@anyAllowed'))
    }
  }
  /* v8 ignore next -- parsed nodes always reach a JSDocable source ancestor */
  return false
}

export function findAnyOccurrences(filePath: string, project: Project): AnyOccurrence[] {
  const sourceFile = project.addSourceFileAtPath(filePath)
  const seenPositions = new Set<number>()
  const occurrences: AnyOccurrence[] = []

  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.AnyKeyword)) {
    const position = node.getStart()
    if (seenPositions.has(position) || isInsideJsDoc(node) || isAllowed(node)) continue
    seenPositions.add(position)

    const location = sourceFile.getLineAndColumnAtPos(position)
    occurrences.push({
      line: location.line,
      column: location.column,
      context: node.getParentOrThrow().getText().replace(/\s+/gu, ' ').slice(0, 120),
    })
  }

  return occurrences
}

export async function runAnyGuard(options: {
  rootDir?: string
  config?: AnyGuardConfig
} = {}): Promise<number> {
  const rootDir = options.rootDir ?? process.cwd()
  const config = options.config ?? await loadGuardConfig('any', rootDir)
  const excludePatterns = compilePatterns(config.excludePatterns, BASE_SOURCE_EXCLUDE_PATTERNS)
  const files = collectFiles(rootDir, config, excludePatterns)

  assertConfiguredScanScope({
    root: rootDir,
    guardName: 'any',
    configPath: 'guards.any.includePaths',
    configuredPaths: config.includePaths,
    eligibleFiles: files,
  })

  console.info(`${colors.bright}${colors.blue}🔍 Running TypeScript any guard...${colors.reset}`)
  console.info(`${colors.cyan}   • Paths: ${config.includePaths.join(', ')}${colors.reset}`)

  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const reports: AnyFileReport[] = []

  for (const filePath of files) {
    const occurrences = findAnyOccurrences(filePath, project)
    if (occurrences.length > 0) {
      reports.push({
        filePath: normalizedRelativePath(rootDir, filePath),
        occurrences,
      })
    }
  }

  if (reports.length === 0) {
    console.info(`${colors.green}${colors.bright}✨ Success! No forbidden 'any' usage found outside excluded files.${colors.reset}`)
    return 0
  }

  const total = reports.reduce((sum, report) => sum + report.occurrences.length, 0)
  console.error(`${colors.bright}${colors.red}Forbidden 'any' usage found (${total} total):${colors.reset}`)
  for (const report of reports) {
    for (const occurrence of report.occurrences) {
      console.error(
        `${colors.gray}${report.filePath}:${occurrence.line}:${occurrence.column}${colors.reset} ${occurrence.context}`,
      )
    }
  }
  return 1
}

/* v8 ignore start -- executable adapter */
if (isMainModule(import.meta.url)) {
  runAnyGuard().then((code) => {
    process.exitCode = code
  }).catch((error: unknown) => {
    console.error((error as Error).message)
    process.exitCode = 1
  })
}
/* v8 ignore stop */
