import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { JSDoc, Node, Project, SourceFile } from 'ts-morph'

import type { WebToolkitCliConfig } from './config.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

type SymbolIssue = {
  name: string
  line: number
  type: 'function' | 'class' | 'interface' | 'type' | 'method' | 'property'
  issues: string[]
}

type FileReport = {
  filePath: string
  totalSymbols: number
  documentedSymbols: number
  coverage: number
  symbolIssues: SymbolIssue[]
}

type ParsedParamTag = {
  name: string
  type: string | null
  optional: boolean
  optionalSyntaxExplicit: boolean
  hasSeparator: boolean
}

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

const defaultExcludePatterns = [
  'node_modules',
  'dist',
  'build',
  '\\.next',
  'coverage',
  '\\.test\\.',
  '\\.spec\\.',
  '\\.config\\.',
  '\\.setup\\.',
]

function colorize(value: string, color: string): string {
  return `${color}${value}${colors.reset}`
}

function shouldProcessFile(filePath: string, excludePatterns: RegExp[]): boolean {
  return /\.(ts|tsx)$/u.test(filePath) && !excludePatterns.some((pattern) => pattern.test(filePath))
}

function collectFiles(rootDir: string, includePaths: string[], excludePatterns: RegExp[]): string[] {
  const files: string[] = []

  function walkDir(dir: string): void {
    if (!existsSync(dir)) return

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!excludePatterns.some((pattern) => pattern.test(fullPath))) {
          walkDir(fullPath)
        }
      } else if (entry.isFile() && shouldProcessFile(fullPath, excludePatterns)) {
        files.push(fullPath)
      }
    }
  }

  for (const includePath of includePaths) {
    walkDir(path.join(rootDir, includePath))
  }

  return files
}

function isFunctionLike(node: Node): boolean {
  return Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isConstructorDeclaration(node)
}

function normalizeTypeText(typeText: string): string {
  return typeText
    .replace(/import\([^)]+\)\./gu, '')
    .replace(/\bReact\.JSX\.Element\b/gu, 'JSX.Element')
    .replace(/\bReact\.ReactElement\b/gu, 'JSX.Element')
    .replace(/\bReactElement\b/gu, 'JSX.Element')
    .replace(/\bBoolean\b/gu, 'boolean')
    .replace(/\bString\b/gu, 'string')
    .replace(/\bNumber\b/gu, 'number')
    .replace(/\bobject\b/gu, 'Object')
    .replace(/\bfunction\b/gu, 'Function')
    .replace(/\s+/gu, '')
    .replace(/;(?=[}\]])/gu, '')
}

function isTypeComparable(typeText: string): boolean {
  return !(
    typeText.includes('import(') ||
    typeText.includes('{') ||
    typeText.includes('}') ||
    typeText.includes('=>') ||
    typeText.includes('\n') ||
    typeText.includes(' is ') ||
    typeText.includes('typeof ')
  )
}

function extractTagType(tagText: string): string | null {
  return tagText.match(/@\w+\s+\{([^}]+)\}/u)?.[1]?.trim() ?? null
}

function parseParamTag(tagText: string): ParsedParamTag | null {
  const paramNameMatch = tagText.match(/@param\s+(?:\{[^}]+\}\s+)?(\[[^\]]+\]|\.{3}[\w$.]+|[\w$.]+)/u)
  if (!paramNameMatch) return null

  let rawName = paramNameMatch[1].trim()
  let optional = false
  let optionalSyntaxExplicit = false

  if (rawName.startsWith('[') && rawName.endsWith(']')) {
    optional = true
    optionalSyntaxExplicit = true
    rawName = rawName.slice(1, -1)
  }

  if (rawName.startsWith('...')) rawName = rawName.slice(3)

  const assignmentIndex = rawName.indexOf('=')
  if (assignmentIndex >= 0) {
    optional = true
    optionalSyntaxExplicit = true
    rawName = rawName.slice(0, assignmentIndex)
  }

  const name = rawName.trim()
  if (!name) return null

  return {
    name,
    type: extractTagType(tagText),
    optional,
    optionalSyntaxExplicit,
    hasSeparator: tagText.includes(' - '),
  }
}

function getLongJSDocLineIssues(jsDocs: JSDoc[], maxLineLength: number): string[] {
  const issues: string[] = []

  for (const jsDoc of jsDocs) {
    const blockStartLine = jsDoc.getStartLineNumber()
    const blockLines = jsDoc.getText().split(/\r?\n/u)

    for (let lineOffset = 0; lineOffset < blockLines.length; lineOffset += 1) {
      const lineLength = blockLines[lineOffset].replace(/\t/gu, '  ').length
      if (lineLength > maxLineLength) {
        issues.push(`JSDoc line too long (line ${blockStartLine + lineOffset}: ${lineLength} > ${maxLineLength})`)
      }
    }
  }

  return issues
}

function validateJSDoc(node: Node, jsDocs: JSDoc[], maxLineLength: number): string[] {
  const issues: string[] = []
  if (jsDocs.length === 0) return ['Missing JSDoc']

  const descriptions = jsDocs.map((jsDoc) => jsDoc.getDescription().trim()).filter(Boolean)
  const allTags = jsDocs.flatMap((jsDoc) => jsDoc.getTags())
  const hasDescriptionTag = allTags.some((tag) => tag.getTagName() === 'description')

  if (descriptions.length === 0 && !hasDescriptionTag) {
    issues.push('Missing description')
  }

  issues.push(...getLongJSDocLineIssues(jsDocs, maxLineLength))

  if (!isFunctionLike(node)) return issues

  const params = Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isConstructorDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
    ? node.getParameters()
    : []
  const hasDestructuredSignatureParam = params.some((param) => {
    const name = param.getName()
    return name.startsWith('{') || name.startsWith('[')
  })
  const signatureParams = params
    .map((param) => {
      const name = param.getName()
      if (name.startsWith('{') || name.startsWith('[')) return null
      return {
        name,
        explicitTypeText: param.getTypeNode()?.getText() ?? null,
        optional: param.isOptional() || param.hasInitializer(),
        optionalSyntaxExplicit: param.hasQuestionToken() || param.hasInitializer(),
      }
    })
    .filter((param): param is NonNullable<typeof param> => param !== null)
  const paramTags = allTags
    .filter((tag) => tag.getTagName() === 'param')
    .map((tag) => ({ parsed: parseParamTag(tag.getText()), rawText: tag.getText() }))
    .filter((entry): entry is { parsed: ParsedParamTag; rawText: string } => entry.parsed !== null)
  const paramTagsByName = new Map<string, { parsed: ParsedParamTag; rawText: string }[]>()

  for (const paramTag of paramTags) {
    const list = paramTagsByName.get(paramTag.parsed.name) ?? []
    list.push(paramTag)
    paramTagsByName.set(paramTag.parsed.name, list)
  }

  for (const param of signatureParams) {
    const matchingTags = paramTagsByName.get(param.name) ?? []
    const paramTag = matchingTags[0]

    if (!paramTag) {
      issues.push(`Missing @param ${param.name}`)
      continue
    }

    if (matchingTags.length > 1) {
      issues.push(`Duplicated @param ${param.name} (${matchingTags.length}x)`)
    }

    if (!paramTag.parsed.type) {
      issues.push(`Missing type in @param ${param.name}`)
    } else if (param.explicitTypeText && isTypeComparable(param.explicitTypeText) && isTypeComparable(paramTag.parsed.type)) {
      const signatureType = normalizeTypeText(param.explicitTypeText)
      const jsDocType = normalizeTypeText(paramTag.parsed.type)
      if (signatureType !== jsDocType) {
        issues.push(`@param ${param.name} type mismatch (JSDoc: {${paramTag.parsed.type}} | signature: ${param.explicitTypeText})`)
      }
    }

    if (!paramTag.parsed.hasSeparator) {
      issues.push(`Missing separator " - " in @param ${param.name}`)
    }

    if (param.optionalSyntaxExplicit && paramTag.parsed.optionalSyntaxExplicit && param.optional !== paramTag.parsed.optional) {
      issues.push(`@param optionality mismatch for ${param.name}`)
    }
  }

  const signatureParamNames = new Set(signatureParams.map((param) => param.name))
  for (const [paramName] of paramTagsByName.entries()) {
    if (!signatureParamNames.has(paramName) && !paramName.includes('.') && !hasDestructuredSignatureParam) {
      issues.push(`@param ${paramName} is not present in signature`)
    }
  }

  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const returnTypeText = node.getReturnType().getText()
    const isVoid = returnTypeText === 'void' || returnTypeText === 'Promise<void>' || returnTypeText === 'undefined'
    const returnTag = allTags.find((tag) => tag.getTagName() === 'returns' || tag.getTagName() === 'return')

    if (!isVoid && !returnTag) {
      issues.push('Missing @returns')
    } else if (returnTag) {
      const returnTagType = extractTagType(returnTag.getText())
      const explicitReturnTypeText = node.getReturnTypeNode()?.getText() ?? null
      if (!returnTagType) {
        issues.push('Missing type in @returns')
      } else if (explicitReturnTypeText && isTypeComparable(explicitReturnTypeText) && isTypeComparable(returnTagType)) {
        const signatureReturnType = normalizeTypeText(explicitReturnTypeText)
        const jsDocReturnType = normalizeTypeText(returnTagType)
        if (signatureReturnType !== jsDocReturnType) {
          issues.push(`@returns type mismatch (JSDoc: {${returnTagType}} | signature: ${explicitReturnTypeText})`)
        }
      }
    }
  }

  return issues
}

function analyzeFile(sourceFile: SourceFile, rootDir: string, maxLineLength: number): FileReport | null {
  const symbolIssues: SymbolIssue[] = []
  let totalSymbols = 0

  for (const func of sourceFile.getFunctions()) {
    totalSymbols += 1
    const issues = validateJSDoc(func, func.getJsDocs(), maxLineLength)
    if (issues.length > 0) {
      symbolIssues.push({ name: func.getName() || '<anonymous>', line: func.getStartLineNumber(), type: 'function', issues })
    }
  }

  for (const cls of sourceFile.getClasses()) {
    totalSymbols += 1
    const className = cls.getName() || '<anonymous>'
    const classIssues = validateJSDoc(cls, cls.getJsDocs(), maxLineLength)
    if (classIssues.length > 0) {
      symbolIssues.push({ name: className, line: cls.getStartLineNumber(), type: 'class', issues: classIssues })
    }

    for (const method of cls.getMethods()) {
      totalSymbols += 1
      const issues = validateJSDoc(method, method.getJsDocs(), maxLineLength)
      if (issues.length > 0) {
        symbolIssues.push({ name: `${className}.${method.getName()}`, line: method.getStartLineNumber(), type: 'method', issues })
      }
    }

    for (const prop of cls.getProperties()) {
      totalSymbols += 1
      if (prop.getJsDocs().length === 0) {
        symbolIssues.push({ name: `${className}.${prop.getName()}`, line: prop.getStartLineNumber(), type: 'property', issues: ['Missing JSDoc'] })
      }
    }
  }

  for (const iface of sourceFile.getInterfaces()) {
    totalSymbols += 1
    const issues = validateJSDoc(iface, iface.getJsDocs(), maxLineLength)
    if (issues.length > 0) {
      symbolIssues.push({ name: iface.getName(), line: iface.getStartLineNumber(), type: 'interface', issues })
    }
  }

  for (const typeAlias of sourceFile.getTypeAliases()) {
    totalSymbols += 1
    const issues = validateJSDoc(typeAlias, typeAlias.getJsDocs(), maxLineLength)
    if (issues.length > 0) {
      symbolIssues.push({ name: typeAlias.getName(), line: typeAlias.getStartLineNumber(), type: 'type', issues })
    }
  }

  for (const variableStatement of sourceFile.getVariableStatements()) {
    for (const declaration of variableStatement.getDeclarations()) {
      const initializer = declaration.getInitializer()
      if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
        totalSymbols += 1
        const issues = validateJSDoc(initializer, variableStatement.getJsDocs(), maxLineLength)
        if (issues.length > 0) {
          symbolIssues.push({ name: declaration.getName(), line: declaration.getStartLineNumber(), type: 'function', issues })
        }
      }
    }
  }

  if (totalSymbols === 0 || symbolIssues.length === 0) return null

  const documentedSymbols = totalSymbols - symbolIssues.length
  return {
    filePath: path.relative(rootDir, sourceFile.getFilePath()),
    totalSymbols,
    documentedSymbols,
    coverage: (documentedSymbols / totalSymbols) * 100,
    symbolIssues,
  }
}

function printReport(reports: FileReport[]): void {
  console.info('')
  console.info(colorize('JSDoc coverage report', `${colors.bright}${colors.cyan}`))
  console.info('')

  if (reports.length === 0) {
    console.info(colorize('All analyzed symbols are documented.', colors.green))
    return
  }

  const sortedReports = [...reports].sort((left, right) => left.coverage - right.coverage)
  const totalSymbols = reports.reduce((sum, report) => sum + report.totalSymbols, 0)
  const totalDocumented = reports.reduce((sum, report) => sum + report.documentedSymbols, 0)
  const overallCoverage = (totalDocumented / totalSymbols) * 100

  console.info(colorize('Review rules:', colors.bright))
  console.info('- Change only JSDoc blocks unless an implementation change is explicitly requested.')
  console.info('- Keep signatures, imports, exports, dependency choices, and runtime behavior unchanged.')
  console.info('- Prefer English JSDoc and explicit types in @param and @returns.')
  console.info('- Use @param {type} name - description syntax.')
  console.info('')
  console.info(colorize('Summary', colors.bright))
  console.info(`Files with issues: ${colorize(String(reports.length), colors.yellow)}`)
  console.info(`Total symbols: ${colorize(String(totalSymbols), colors.cyan)}`)
  console.info(`Documented symbols: ${colorize(String(totalDocumented), colors.green)}`)
  console.info(`Missing/invalid JSDoc: ${colorize(String(totalSymbols - totalDocumented), colors.red)}`)
  console.info(`Overall coverage: ${colorize(`${overallCoverage.toFixed(1)}%`, overallCoverage >= 80 ? colors.green : overallCoverage >= 50 ? colors.yellow : colors.red)}`)
  console.info('')
  console.info(colorize('Top 10 files with issues', colors.bright))

  for (const [index, report] of sortedReports.slice(0, 10).entries()) {
    console.info('')
    console.info(`${index + 1}. ${colorize(report.filePath, colors.bright)}`)
    console.info(`   Coverage: ${report.coverage.toFixed(1)}% (${report.documentedSymbols}/${report.totalSymbols})`)
    for (const symbol of report.symbolIssues) {
      console.info(`   - ${symbol.type} ${symbol.name} (line ${symbol.line})`)
      for (const issue of symbol.issues) {
        console.info(`     * ${issue}`)
      }
    }
  }

  if (sortedReports.length > 10) {
    console.info('')
    console.info(colorize(`...and ${sortedReports.length - 10} more files with issues.`, colors.gray))
  }
}

function generateMarkdownReport(reports: FileReport[]): string {
  const sortedReports = [...reports].sort((left, right) => left.coverage - right.coverage)
  const totalSymbols = reports.reduce((sum, report) => sum + report.totalSymbols, 0)
  const totalDocumented = reports.reduce((sum, report) => sum + report.documentedSymbols, 0)
  const overallCoverage = totalSymbols === 0 ? 100 : (totalDocumented / totalSymbols) * 100
  const lines = [
    '# JSDoc Coverage Report',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Review Rules',
    '',
    '- Change only JSDoc blocks unless an implementation change is explicitly requested.',
    '- Keep signatures, imports, exports, dependency choices, and runtime behavior unchanged.',
    '- Prefer English JSDoc and explicit types in `@param` and `@returns`.',
    '- Use `@param {type} name - description` syntax.',
    '',
    '## Summary',
    '',
    `- Files with issues: ${reports.length}`,
    `- Total symbols: ${totalSymbols}`,
    `- Documented symbols: ${totalDocumented}`,
    `- Missing/invalid JSDoc: ${totalSymbols - totalDocumented}`,
    `- Overall coverage: ${overallCoverage.toFixed(1)}%`,
    '',
    '## Files With Issues',
    '',
  ]

  if (sortedReports.length === 0) {
    lines.push('All analyzed symbols are documented.', '')
    return lines.join('\n')
  }

  for (const [index, report] of sortedReports.entries()) {
    lines.push(`### ${index + 1}. ${report.filePath}`)
    lines.push('')
    lines.push(`Coverage: ${report.coverage.toFixed(1)}% (${report.documentedSymbols}/${report.totalSymbols})`)
    lines.push('')
    for (const symbol of report.symbolIssues) {
      lines.push(`- \`${symbol.name}\` (${symbol.type}, line ${symbol.line})`)
      for (const issue of symbol.issues) {
        lines.push(`  - ${issue}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function shouldWriteMarkdown(promptForReport: boolean, rawArgs: string[]): Promise<boolean> {
  if (rawArgs.includes('--write') || rawArgs.includes('--report')) return true
  if (rawArgs.includes('--no-report')) return false
  if (!promptForReport) return false
  if (!input.isTTY || !output.isTTY) return false

  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question(`${colorize('Generate full Markdown report? (s/N): ', colors.cyan)}`)
    return ['s', 'sim', 'y', 'yes'].includes(answer.trim().toLowerCase())
  } finally {
    rl.close()
  }
}

export async function runJSDocReport(runtime: Runtime, rawArgs: string[]): Promise<void> {
  const config = runtime.config.jsdocReport
  if (!config?.includePaths?.length) {
    throw new Error('jsdocReport.includePaths is not configured.')
  }

  const maxLineLengthFromEnv = Number(process.env.JSDOC_MAX_LINE_LENGTH)
  const maxLineLength = Number.isFinite(maxLineLengthFromEnv) && maxLineLengthFromEnv > 0
    ? maxLineLengthFromEnv
    : config.maxLineLength ?? 250
  const excludePatterns = (config.excludePatterns ?? defaultExcludePatterns).map((pattern) => new RegExp(pattern, 'u'))
  const fileArgs = rawArgs.filter((arg) => !arg.startsWith('-'))
  const files = fileArgs.length > 0
    ? fileArgs.map((arg) => path.resolve(process.cwd(), arg)).filter(existsSync)
    : collectFiles(runtime.cwd, config.includePaths, excludePatterns)

  console.info(colorize(`Analyzing ${files.length} TypeScript file(s)...`, colors.cyan))
  const project = new Project({
    tsConfigFilePath: path.join(runtime.cwd, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  })
  const reports: FileReport[] = []

  for (const [index, filePath] of files.entries()) {
    if (files.length > 0) {
      process.stdout.write(`\rJSDoc analysis ${index + 1}/${files.length}`)
    }

    try {
      const sourceFile = project.addSourceFileAtPath(filePath)
      const report = analyzeFile(sourceFile, runtime.cwd, maxLineLength)
      if (report) reports.push(report)
      project.removeSourceFile(sourceFile)
    } catch (error) {
      console.error(`\nFailed to analyze ${filePath}`)
      console.error(error)
    }
  }

  if (files.length > 0) console.info('\n')
  printReport(reports)

  if (await shouldWriteMarkdown(config.promptForReport ?? false, rawArgs)) {
    const outputPath = path.join(runtime.cwd, config.reportFile ?? 'temp_jsdocs_check.md')
    writeFileSync(outputPath, generateMarkdownReport(reports), 'utf8')
    console.info('')
    console.info(colorize(`Markdown report generated: ${path.relative(runtime.cwd, outputPath)}`, colors.green))
  }
}
