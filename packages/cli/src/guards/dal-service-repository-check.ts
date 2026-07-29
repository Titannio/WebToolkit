#!/usr/bin/env tsx
/**
 * DAL + Service + Repository Compliance Report
 *
 * Analyzes backend layers and identifies architectural boundary violations
 * between controllers, services, repositories, routes, middleware, and the
 * central DAL aggregator.
 */

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { DalServiceRepositoryGuardConfig, LayerConfig } from '../config.js'
import { BASE_LAYER_EXCLUDE_PATTERNS, BASE_TYPESCRIPT_EXTENSIONS, assertConfiguredScanScope, compilePatterns, hasExtension, isMainModule, loadGuardConfig, resolveProjectPath } from './guard-config.js'

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

type LayerViolation = {
  ruleId: string
  message: string
  line: number
  importPath: string
  targetLayer: string
}

type FileReport = {
  filePath: string
  layer: string
  evaluated: boolean
  violations: LayerViolation[]
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function isAllowedFile(filePath: string, excludePatterns: RegExp[]): boolean {
  if (!hasExtension(filePath, BASE_TYPESCRIPT_EXTENSIONS)) return false
  return !excludePatterns.some((pattern) => pattern.test(filePath))
}

function collectFiles(rootDir: string, excludePatterns: RegExp[]): string[] {
  const files: string[] = []

  const walk = (dir: string): void => {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!excludePatterns.some((pattern) => pattern.test(fullPath))) {
          walk(fullPath)
        }
        continue
      }

      if (entry.isFile() && isAllowedFile(fullPath, excludePatterns)) {
        files.push(fullPath)
      }
    }
  }

  walk(rootDir)

  return files
}

function readCompilerOptions(tsconfigPath: string): ts.CompilerOptions {
  const configResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configResult.error) {
    const message = ts.flattenDiagnosticMessageText(configResult.error.messageText, '\n')
    throw new Error(`Failed to read backend tsconfig: ${message}`)
  }

  const parsed = ts.parseJsonConfigFileContent(
    configResult.config,
    ts.sys,
    path.dirname(tsconfigPath),
  )

  return parsed.options
}

function matchesPath(relativePath: string, configuredPath: string): boolean {
  const normalized = normalizeFilePath(configuredPath).replace(/^\/|\/$/g, '')
  return relativePath === normalized || relativePath.startsWith(`${normalized}/`)
}

function classifyLayer(filePath: string, sourceDirectory: string, layers: LayerConfig[]): string {
  const normalized = normalizeFilePath(path.resolve(filePath))

  const relative = normalizeFilePath(path.relative(sourceDirectory, normalized))
  for (const layer of layers) {
    if ((layer.exclude ?? []).some((excluded) => matchesPath(relative, excluded))) continue
    if (layer.paths.some((candidate) => matchesPath(relative, candidate))) return layer.name
  }

  return 'other'
}

function isInternalSourceFile(filePath: string, sourceDirectory: string): boolean {
  const relativePath = path.relative(sourceDirectory, path.resolve(filePath))
  return relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath)
}

function resolveImportTarget(
  sourceFileName: string,
  moduleSpecifier: string,
  compilerOptions: ts.CompilerOptions,
): string | null {
  const resolved = ts.resolveModuleName(moduleSpecifier, sourceFileName, compilerOptions, ts.sys)
  return resolved.resolvedModule?.resolvedFileName ?? null
}

function isViolation(
  sourceLayer: string,
  targetLayer: string,
  forbiddenDependencies: Record<string, string[]>,
): boolean {
  return (forbiddenDependencies[sourceLayer] ?? []).includes(targetLayer)
}

function buildViolationMessage(sourceLayer: string, targetLayer: string): string {
  return `${sourceLayer} cannot depend directly on ${targetLayer}`
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function printHeader(): void {
  console.log(`${colors.bright}${colors.blue}╔═══════════════════════════════════════════════════════════════╗${colors.reset}`)
  console.log(`${colors.bright}${colors.blue}║       DAL + Service + Repository Compliance Report            ║${colors.reset}`)
  console.log(`${colors.bright}${colors.blue}╚═══════════════════════════════════════════════════════════════╝${colors.reset}`)
  console.log()
}

function getLineNumber(sourceFile: ts.SourceFile, position: number): number {
  const lineAndChar = sourceFile.getLineAndCharacterOfPosition(position)
  return lineAndChar.line + 1
}

export async function runDalServiceRepositoryGuard(options: {
  rootDir?: string
  config?: DalServiceRepositoryGuardConfig
} = {}): Promise<number> {
  const rootDir = options.rootDir ?? process.cwd()
  const config = options.config ?? await loadGuardConfig('dalServiceRepository', rootDir)
  /* v8 ignore next -- every invalid operand and the valid fallthrough are asserted */
  if (!config.sourceDirectory || !config.tsconfig || config.layers.length === 0) {
    throw new Error('guards.dalServiceRepository requires sourceDirectory, tsconfig and non-empty layers.')
  }
  const sourceDirectory = resolveProjectPath(rootDir, config.sourceDirectory)
  const tsconfigPath = resolveProjectPath(rootDir, config.tsconfig)
  const excludePatterns = compilePatterns(config.excludePatterns, BASE_LAYER_EXCLUDE_PATTERNS)
  const evaluatedLayers = new Set(config.layers.map((layer) => layer.name))
  printHeader()

  console.log(`${colors.cyan}Scope:${colors.reset} ${normalizeFilePath(path.relative(rootDir, sourceDirectory))}`)
  console.log(`${colors.cyan}Rules:${colors.reset}`)
  for (const [layer, forbidden] of Object.entries(config.forbiddenDependencies)) {
    console.log(`  - ${layer} cannot import ${forbidden.join(', ')}`)
  }
  console.log()

  const compilerOptions = readCompilerOptions(tsconfigPath)
  const files = collectFiles(sourceDirectory, excludePatterns)
  assertConfiguredScanScope({
    root: rootDir,
    guardName: 'dal-service-repository',
    configPath: 'guards.dalServiceRepository.sourceDirectory',
    configuredPaths: [config.sourceDirectory],
    eligibleFiles: files,
  })

  const reports: FileReport[] = []
  const ruleCounts = new Map<string, number>()
  const layerCounts = new Map<string, number>()
  let evaluatedFiles = 0
  let compliantFiles = 0
  let totalViolations = 0

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const layer = classifyLayer(filePath, sourceDirectory, config.layers)
    const evaluated = evaluatedLayers.has(layer)
    const violations: LayerViolation[] = []

    if (evaluated) evaluatedFiles++
    if (evaluated) {
      layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1)
    }

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue

      if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue
      const moduleSpecifier = statement.moduleSpecifier.text
      const resolvedFileName = resolveImportTarget(filePath, moduleSpecifier, compilerOptions)
      if (!resolvedFileName) continue

      if (!isInternalSourceFile(resolvedFileName, sourceDirectory)) continue

      const targetLayer = classifyLayer(resolvedFileName, sourceDirectory, config.layers)
      if (targetLayer === 'other') continue

      if (!evaluated) continue
      if (!isViolation(layer, targetLayer, config.forbiddenDependencies)) continue

      const line = getLineNumber(sourceFile, statement.getStart(sourceFile))
      const ruleId = `${layer}-forbidden-${targetLayer}`
      violations.push({
        ruleId,
        message: buildViolationMessage(layer, targetLayer),
        line,
        importPath: normalizeFilePath(path.relative(rootDir, resolvedFileName)),
        targetLayer,
      })
    }

    if (evaluated) {
      if (violations.length === 0) {
        compliantFiles++
      } else {
        totalViolations += violations.length
        for (const violation of violations) {
          ruleCounts.set(violation.ruleId, (ruleCounts.get(violation.ruleId) ?? 0) + 1)
        }
      }
    }

    reports.push({
      filePath: normalizeFilePath(path.relative(rootDir, filePath)),
      layer,
      evaluated,
      violations,
    })
  }

  const evaluatedReports = reports.filter((report) => report.evaluated)
  const violatingReports = evaluatedReports.filter((report) => report.violations.length > 0)
  const complianceRate = evaluatedFiles === 0 ? 100 : (compliantFiles / evaluatedFiles) * 100

  console.log(`${colors.bright}${colors.blue}Summary${colors.reset}`)
  console.log(`${colors.gray}────────${colors.reset}`)
  console.log(`Evaluated files: ${colors.bright}${evaluatedFiles}${colors.reset}`)
  console.log(`Compliant files: ${colors.bright}${colors.green}${compliantFiles}${colors.reset}`)
  console.log(`Files with violations: ${colors.bright}${colors.red}${violatingReports.length}${colors.reset}`)
  console.log(`Total violations: ${colors.bright}${colors.red}${totalViolations}${colors.reset}`)
  console.log(
    `Compliance rate: ${colors.bright}${complianceRate >= 90 ? colors.green : complianceRate >= 70 ? colors.yellow : colors.red}${formatPercent(complianceRate)}${colors.reset}`,
  )
  console.log()

  if (layerCounts.size > 0) {
    console.log(`${colors.bright}${colors.blue}Layer coverage${colors.reset}`)
    console.log(`${colors.gray}────────────────${colors.reset}`)
    for (const [layer, count] of Array.from(layerCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`- ${layer}: ${count}`)
    }
    console.log()
  }

  if (ruleCounts.size > 0) {
    console.log(`${colors.bright}${colors.blue}Violation groups${colors.reset}`)
    console.log(`${colors.gray}────────────────${colors.reset}`)
    for (const [ruleId, count] of Array.from(ruleCounts.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`- ${ruleId}: ${count}`)
    }
    console.log()
  }

  if (violatingReports.length > 0) {
    console.log(`${colors.bright}${colors.red}Files with violations${colors.reset}`)
    console.log(`${colors.gray}─────────────────────${colors.reset}`)

    const sortedReports = violatingReports.toSorted((a, b) => b.violations.length - a.violations.length)
    for (const report of sortedReports.slice(0, 20)) {
      console.log(`${colors.bright}${report.filePath}${colors.reset} [${report.layer}] (${report.violations.length})`)
      for (const violation of report.violations.slice(0, 5)) {
        console.log(
          `  ${colors.gray}L${violation.line}${colors.reset} ${violation.ruleId} -> ${violation.message} ${colors.gray}[${violation.importPath}]${colors.reset}`,
        )
      }
      if (report.violations.length > 5) {
        console.log(`  ${colors.gray}... and ${report.violations.length - 5} more violation(s)${colors.reset}`)
      }
      console.log()
    }

    if (sortedReports.length > 20) {
      console.log(`${colors.gray}... and ${sortedReports.length - 20} more file(s) with violations${colors.reset}`)
      console.log()
    }
  } else {
    console.log(`${colors.green}${colors.bright}No DAL/Service/Repository boundary violations found.${colors.reset}`)
    console.log()
  }

  console.log(`${colors.cyan}Notes:${colors.reset}`)
  console.log(`- Only files classified by the configured layers are evaluated`)
  console.log(`- This report is deterministic and exits with code 1 when violations exist`)
  console.log()

  return totalViolations > 0 ? 1 : 0
}

/* v8 ignore start -- executable adapter */
if (isMainModule(import.meta.url)) {
  runDalServiceRepositoryGuard().then((code) => {
    process.exitCode = code
  }).catch((error: unknown) => {
    console.error(`${colors.bright}${colors.red}Failed to generate DAL compliance report:${colors.reset}`, error)
    process.exitCode = 1
  })
}
/* v8 ignore stop */
