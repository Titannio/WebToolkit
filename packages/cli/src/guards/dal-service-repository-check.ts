#!/usr/bin/env tsx
// @ts-nocheck
/**
 * DAL + Service + Repository Compliance Report
 *
 * Analisa a camada backend e identifica violacoes de fronteira arquitetural
 * entre Controllers, Services, Repositories, Routes, Middlewares e o agregador
 * central de DAL.
 */

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

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

const ROOT_DIR = process.cwd()
const BACKEND_SRC_DIR = path.resolve(ROOT_DIR, 'apps/backend/src')
const BACKEND_TS_CONFIG = path.resolve(ROOT_DIR, 'apps/backend/tsconfig.json')

const INCLUDE_DIRS = [BACKEND_SRC_DIR]

const EXCLUDE_PATTERNS = [
  /node_modules/,
  /dist/,
  /build/,
  /coverage/,
  /\.test\./,
  /\.spec\./,
  /\.config\./,
  /\.setup\./,
]

const EVALUATED_LAYERS = new Set([
  'controller',
  'service',
  'repository',
  'route',
  'middleware',
  'db',
  'model',
  'mapper',
])

const FORBIDDEN_TARGETS_BY_LAYER = {
  controller: new Set(['db', 'repository', 'model']),
  service: new Set(['controller', 'route', 'model']),
  repository: new Set(['controller', 'service', 'route', 'middleware']),
  route: new Set(['db', 'repository', 'model', 'service']),
  middleware: new Set(['db', 'repository', 'model', 'controller', 'route']),
  db: new Set(['controller', 'service', 'route', 'middleware', 'model']),
  model: new Set(['controller', 'service', 'route', 'middleware', 'db', 'repository']),
  mapper: new Set(['controller', 'service', 'route', 'middleware', 'db', 'repository']),
  other: new Set(),
}

function normalizeFilePath(filePath) {
  return filePath.replace(/\\/g, '/')
}

function isAllowedFile(filePath) {
  if (!filePath.match(/\.(ts|tsx)$/)) return false
  return !EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath))
}

function collectFiles(rootDir) {
  const files = []

  const walk = (dir) => {
    if (!fs.existsSync(dir)) return

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!EXCLUDE_PATTERNS.some((pattern) => pattern.test(fullPath))) {
          walk(fullPath)
        }
        continue
      }

      if (entry.isFile() && isAllowedFile(fullPath)) {
        files.push(fullPath)
      }
    }
  }

  for (const includeDir of INCLUDE_DIRS) {
    walk(includeDir)
  }

  return files
}

function readBackendCompilerOptions() {
  const configResult = ts.readConfigFile(BACKEND_TS_CONFIG, ts.sys.readFile)
  if (configResult.error) {
    const message = ts.flattenDiagnosticMessageText(configResult.error.messageText, '\n')
    throw new Error(`Failed to read backend tsconfig: ${message}`)
  }

  const parsed = ts.parseJsonConfigFileContent(
    configResult.config,
    ts.sys,
    path.dirname(BACKEND_TS_CONFIG),
  )

  return parsed.options
}

function classifyLayer(filePath) {
  const normalized = normalizeFilePath(path.resolve(filePath))
  const backendRoot = normalizeFilePath(BACKEND_SRC_DIR)

  if (!normalized.startsWith(backendRoot)) return 'other'

  const relative = normalizeFilePath(path.relative(BACKEND_SRC_DIR, normalized))

  if (relative === 'db/index.ts') return 'db'
  if (relative.startsWith('controllers/utils/')) return 'other'
  if (relative.startsWith('controllers/')) return 'controller'
  if (relative.startsWith('services/')) return 'service'
  if (relative.startsWith('db/repositories/')) return 'repository'
  if (relative.startsWith('routes/')) return 'route'
  if (relative.startsWith('middlewares/')) return 'middleware'
  if (relative.startsWith('models/')) return 'model'
  if (relative.startsWith('mappers/')) return 'mapper'

  return 'other'
}

function isInternalBackendFile(filePath) {
  const normalized = normalizeFilePath(path.resolve(filePath))
  return normalized.startsWith(normalizeFilePath(BACKEND_SRC_DIR))
}

function resolveImportTarget(sourceFileName, moduleSpecifier, compilerOptions) {
  const resolved = ts.resolveModuleName(moduleSpecifier, sourceFileName, compilerOptions, ts.sys)
  return resolved.resolvedModule?.resolvedFileName ?? null
}

function isViolation(sourceLayer, targetLayer) {
  const forbidden = FORBIDDEN_TARGETS_BY_LAYER[sourceLayer] ?? FORBIDDEN_TARGETS_BY_LAYER.other
  return forbidden.has(targetLayer)
}

function buildViolationMessage(sourceLayer, targetLayer) {
  switch (sourceLayer) {
    case 'controller':
      return `Controllers cannot depend directly on ${targetLayer} files`
    case 'service':
      return `Services cannot depend directly on ${targetLayer} files`
    case 'repository':
      return `Repositories cannot depend directly on ${targetLayer} files`
    case 'route':
      return `Routes cannot depend directly on ${targetLayer} files`
    case 'middleware':
      return `Middlewares cannot depend directly on ${targetLayer} files`
    case 'db':
      return 'The DAL aggregator must only compose repository dependencies'
    default:
      return `Layer boundary violation against ${targetLayer}`
  }
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`
}

function printHeader() {
  console.log(`${colors.bright}${colors.blue}╔═══════════════════════════════════════════════════════════════╗${colors.reset}`)
  console.log(`${colors.bright}${colors.blue}║       DAL + Service + Repository Compliance Report            ║${colors.reset}`)
  console.log(`${colors.bright}${colors.blue}╚═══════════════════════════════════════════════════════════════╝${colors.reset}`)
  console.log()
}

function getLineNumber(sourceFile, position) {
  const lineAndChar = sourceFile.getLineAndCharacterOfPosition(position)
  return lineAndChar.line + 1
}

async function main() {
  printHeader()

  console.log(`${colors.cyan}Scope:${colors.reset} ${normalizeFilePath(path.relative(ROOT_DIR, BACKEND_SRC_DIR))}`)
  console.log(`${colors.cyan}Rules:${colors.reset}`)
  console.log(`  - Controllers cannot import DB, Repository or Model layers directly`)
  console.log(`  - Services cannot import Controllers, Routes or Models directly`)
  console.log(`  - Repositories cannot import Controllers, Services, Routes or Middlewares directly`)
  console.log(`  - Routes and Middlewares cannot access DAL/Model layers directly`)
  console.log()

  const compilerOptions = readBackendCompilerOptions()
  const files = collectFiles(BACKEND_SRC_DIR)

  const reports = []
  const ruleCounts = new Map()
  const layerCounts = new Map()
  let evaluatedFiles = 0
  let compliantFiles = 0
  let totalViolations = 0

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const layer = classifyLayer(filePath)
    const evaluated = EVALUATED_LAYERS.has(layer)
    const violations = []

    if (evaluated) evaluatedFiles++
    if (evaluated) {
      layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1)
    }

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue

      const moduleSpecifier = statement.moduleSpecifier.text
      const resolvedFileName = resolveImportTarget(filePath, moduleSpecifier, compilerOptions)
      if (!resolvedFileName) continue

      if (!isInternalBackendFile(resolvedFileName)) continue

      const targetLayer = classifyLayer(resolvedFileName)
      if (targetLayer === 'other') continue

      if (!evaluated) continue
      if (!isViolation(layer, targetLayer)) continue

      const line = getLineNumber(sourceFile, statement.getStart(sourceFile))
      const ruleId = `${layer}-forbidden-${targetLayer}`
      violations.push({
        ruleId,
        message: buildViolationMessage(layer, targetLayer),
        line,
        importPath: normalizeFilePath(path.relative(ROOT_DIR, resolvedFileName)),
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
      filePath: normalizeFilePath(path.relative(ROOT_DIR, filePath)),
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
  console.log(`- Models and mappers are scored in this report, but only against boundary violations`)
  console.log(`- Only backend files that participate in the DAL/Service/Repository boundary are evaluated`)
  console.log(`- This report is deterministic and exits with code 1 when violations exist`)
  console.log()

  process.exit(totalViolations > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(`${colors.bright}${colors.red}Failed to generate DAL compliance report:${colors.reset}`, error)
  process.exit(1)
})
