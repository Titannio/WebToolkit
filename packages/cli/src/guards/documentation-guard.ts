import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, matchesGlob, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig, type DocumentationConfig } from '../config.js'

const defaultExcludedDirectories = new Set(['.corepack', '.git', 'build', 'coverage', 'dist', 'node_modules'])

type Heading = { level: number; line: number; text: string }
type Link = { target: string; line: number }
type ParsedMarkdown = { headings: Heading[]; links: Link[]; metadata: Map<string, string>; content: string }

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/')
}

function relativePath(root: string, filePath: string): string {
  return normalizePath(relative(root, filePath))
}

function isInsideRoot(root: string, filePath: string): boolean {
  const fromRoot = relative(root, filePath)
  return fromRoot !== '..' && !fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(fromRoot)
}

function assertStringArray(value: unknown, label: string, required = false): asserts value is string[] {
  if ((!required && value === undefined) || (Array.isArray(value) && value.every((item) => typeof item === 'string') && (!required || value.length > 0))) return
  throw new Error(`${label} must be ${required ? 'a non-empty ' : 'an '}array of strings.`)
}

function assertSafePattern(pattern: string, label: string): void {
  const comparable = pattern.replaceAll('{basename}', 'file.md').replaceAll('{stem}', 'file')
  if (isAbsolute(comparable) || normalizePath(comparable).split('/').includes('..')) {
    throw new Error(`${label} must stay inside the repository: ${pattern}`)
  }
}

export function validateDocumentationConfig(config: DocumentationConfig): void {
  assertStringArray(config.files, 'documentation.files', true)
  assertStringArray(config.excludeDirectories, 'documentation.excludeDirectories')
  assertStringArray(config.requiredFiles, 'documentation.requiredFiles')

  const patterns = [...config.files, ...(config.requiredFiles ?? [])]
  const reachability = config.checks?.reachability
  if (reachability) {
    assertStringArray(reachability.entrypoints, 'documentation.checks.reachability.entrypoints', true)
    assertStringArray(reachability.files, 'documentation.checks.reachability.files', true)
    patterns.push(...reachability.entrypoints, ...reachability.files)
  }

  if (config.collections !== undefined && !Array.isArray(config.collections)) throw new Error('documentation.collections must be an array.')
  for (const [index, collection] of (config.collections ?? []).entries()) {
    assertStringArray(collection.files, `documentation.collections[${index}].files`, true)
    assertStringArray(collection.exclude, `documentation.collections[${index}].exclude`)
    patterns.push(...collection.files, ...(collection.exclude ?? []))
    if (collection.index) patterns.push(collection.index)
    if (collection.metadata && (typeof collection.metadata !== 'object' || Array.isArray(collection.metadata))) {
      throw new Error(`documentation.collections[${index}].metadata must be an object.`)
    }
    const paired = collection.pairedDocuments
    if (paired) {
      if (typeof paired.target !== 'string' || paired.target.length === 0) throw new Error(`documentation.collections[${index}].pairedDocuments.target must be a string.`)
      patterns.push(paired.target)
      if (paired.index) patterns.push(paired.index)
      if (paired.table) {
        assertStringArray(paired.table.header, `documentation.collections[${index}].pairedDocuments.table.header`, true)
        if (!paired.table.header.includes(paired.table.fileColumn)) throw new Error(`documentation.collections[${index}].pairedDocuments.table.fileColumn must name a header column.`)
      }
    }
  }

  if (config.inventories !== undefined && !Array.isArray(config.inventories)) throw new Error('documentation.inventories must be an array.')
  for (const [index, inventory] of (config.inventories ?? []).entries()) {
    if (typeof inventory.document !== 'string' || inventory.document.length === 0) throw new Error(`documentation.inventories[${index}].document must be a string.`)
    assertStringArray(inventory.sources, `documentation.inventories[${index}].sources`, true)
    patterns.push(inventory.document, ...inventory.sources)
  }

  for (const pattern of patterns) assertSafePattern(pattern, 'Documentation path')
}

function walkFiles(directory: string, excludedDirectories: Set<string>): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name)
    if (entry.isDirectory()) return excludedDirectories.has(entry.name) ? [] : walkFiles(filePath, excludedDirectories)
    return entry.isFile() ? [filePath] : []
  })
}

function matches(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(normalizePath(filePath), normalizePath(pattern)))
}

function inspectMarkdown(filePath: string): ParsedMarkdown {
  const content = readFileSync(filePath, 'utf8')
  const headings: Heading[] = []
  const links: Link[] = []
  const metadata = new Map<string, string>()
  let fence: string | undefined

  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/u)
    if (fenceMatch) {
      fence = fence ? undefined : fenceMatch[1][0]
      continue
    }
    if (fence) continue

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/u)
    if (heading) headings.push({ level: heading[1].length, text: heading[2], line: index + 1 })

    const metadataMatch = line.match(/^>\s+\*\*([^*]+):\*\*\s+(.+?)\s{0,2}$/u)
    if (metadataMatch) metadata.set(metadataMatch[1], metadataMatch[2])

    for (const linkMatch of line.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/gu)) {
      links.push({ target: linkMatch[1].replace(/^<|>$/gu, ''), line: index + 1 })
    }
  }

  return { headings, links, metadata, content }
}

function resolveLocalTarget(root: string, source: string, target: string): string | undefined {
  if (!target || target.startsWith('#') || target.startsWith('//') || /^[a-z][a-z\d+.-]*:/iu.test(target)) return undefined
  const pathPart = target.split(/[?#]/u, 1)[0]
  if (!pathPart) return undefined
  let decoded = pathPart
  try {
    decoded = decodeURIComponent(pathPart)
  } catch {
    // Keep the original path so malformed links are reported as missing.
  }
  return resolve(pathPart.startsWith('/') ? root : dirname(source), pathPart.startsWith('/') ? `.${decoded}` : decoded)
}

function resolvedMarkdownTarget(root: string, source: string, target: string): string | undefined {
  const resolved = resolveLocalTarget(root, source, target)
  if (!resolved || !existsSync(resolved)) return resolved
  return statSync(resolved).isDirectory() ? join(resolved, 'README.md') : resolved
}

function linkCount(root: string, source: string, parsed: ParsedMarkdown, target: string): number {
  return parsed.links.filter((link) => resolvedMarkdownTarget(root, source, link.target) === target).length
}

function interpolate(template: string, source: string): string {
  const fileName = basename(source)
  return template.replaceAll('{basename}', fileName).replaceAll('{stem}', basename(fileName, extname(fileName)))
}

function markdownCells(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim())
}

function validatePairContent(root: string, target: string, parsed: ParsedMarkdown, pair: NonNullable<NonNullable<DocumentationConfig['collections']>[number]['pairedDocuments']>): string[] {
  const errors: string[] = []
  const display = relativePath(root, target)

  if (pair.table) {
    const lines = parsed.content.split(/\r?\n/u)
    const headerIndex = lines.findIndex((line) => JSON.stringify(markdownCells(line)) === JSON.stringify(pair.table?.header))
    if (headerIndex < 0) {
      errors.push(`${display}: missing table header | ${pair.table.header.join(' | ')} |`)
    } else {
      const columnIndex = pair.table.header.indexOf(pair.table.fileColumn)
      const rows: string[][] = []
      for (let index = headerIndex + 2; index < lines.length; index += 1) {
        const cells = markdownCells(lines[index])
        if (cells.length === 0) break
        rows.push(cells)
      }
      if (rows.length < (pair.table.minRows ?? 1)) errors.push(`${display}: table requires at least ${pair.table.minRows ?? 1} data row(s)`)
      for (const row of rows) {
        const references = [...(row[columnIndex] ?? '').matchAll(/`([^`]+)`/gu)].map((match) => match[1])
        const invalidReference = references.find((reference) => {
          const filePath = resolve(root, reference)
          return !isInsideRoot(root, filePath) || !existsSync(filePath) || !statSync(filePath).isFile()
        })
        if (references.length === 0 || invalidReference) {
          errors.push(`${display}: invalid or missing file reference in ${pair.table.fileColumn}: ${row[columnIndex] ?? ''}`)
        }
      }
    }
  }

  if (pair.finalSection) {
    const headings = parsed.headings.filter((heading) => heading.level === 2)
    const section = headings.find((heading) => heading.text === pair.finalSection?.heading)
    if (!section) {
      errors.push(`${display}: missing final section ## ${pair.finalSection.heading}`)
    } else {
      if (headings.at(-1) !== section) errors.push(`${display}: ## ${pair.finalSection.heading} must be the final H2 section`)
      const lines = parsed.content.split(/\r?\n/u).slice(section.line)
      const items = lines.filter((line) => /^\s*-\s+\S/u.test(line)).length
      if (items < (pair.finalSection.minItems ?? 1)) errors.push(`${display}: final section requires at least ${pair.finalSection.minItems ?? 1} list item(s)`)
    }
  }

  return errors
}

export function checkDocumentation(root: string, config: DocumentationConfig): string[] {
  validateDocumentationConfig(config)
  const excluded = config.excludeDirectories ? new Set(config.excludeDirectories) : defaultExcludedDirectories
  const allFiles = walkFiles(root, excluded)
  const relativeFiles = new Map(allFiles.map((file) => [file, relativePath(root, file)]))
  const documentFiles = allFiles.filter((file) => matches(relativeFiles.get(file) ?? '', config.files))
  const parsed = new Map(documentFiles.map((file) => [file, inspectMarkdown(file)]))
  const errors: string[] = []

  for (const [file, markdown] of parsed) {
    const display = relativePath(root, file)
    if (config.checks?.singleH1 !== false) {
      const h1Count = markdown.headings.filter((heading) => heading.level === 1).length
      if (h1Count !== 1) errors.push(`${display}: expected exactly one H1; found ${h1Count}`)
    }
    if (config.checks?.headingOrder !== false) {
      for (let index = 1; index < markdown.headings.length; index += 1) {
        const previous = markdown.headings[index - 1]
        const current = markdown.headings[index]
        if (current.level > previous.level + 1) errors.push(`${display}:${current.line}: heading jumps from H${previous.level} to H${current.level}`)
      }
    }
    if (config.checks?.localLinks !== false) {
      for (const link of markdown.links) {
        const target = resolveLocalTarget(root, file, link.target)
        if (target && (!isInsideRoot(root, target) || !existsSync(target))) errors.push(`${display}:${link.line}: broken or unsafe local link: ${link.target}`)
      }
    }
  }

  const reachability = config.checks?.reachability
  if (reachability) {
    const roots = documentFiles.filter((file) => matches(relativeFiles.get(file) ?? '', reachability.entrypoints))
    const reachable = new Set(roots)
    const queue = [...roots]
    while (queue.length > 0) {
      const source = queue.shift() as string
      for (const link of parsed.get(source)?.links ?? []) {
        const target = resolvedMarkdownTarget(root, source, link.target)
        if (!target || reachable.has(target) || !parsed.has(target)) continue
        reachable.add(target)
        queue.push(target)
      }
    }
    for (const file of documentFiles.filter((candidate) => matches(relativeFiles.get(candidate) ?? '', reachability.files))) {
      if (!reachable.has(file)) errors.push(`${relativePath(root, file)}: document is unreachable from configured entrypoints`)
    }
  }

  for (const requiredFile of config.requiredFiles ?? []) {
    if (!existsSync(resolve(root, requiredFile))) errors.push(`${normalizePath(requiredFile)}: required documentation file is missing`)
  }

  for (const collection of config.collections ?? []) {
    const sources = documentFiles.filter((file) => {
      const display = relativeFiles.get(file) ?? ''
      return matches(display, collection.files) && !matches(display, collection.exclude ?? [])
    })
    const indexPath = collection.index ? resolve(root, collection.index) : undefined
    const indexMarkdown = indexPath && existsSync(indexPath) ? inspectMarkdown(indexPath) : undefined
    if (indexPath && !indexMarkdown) errors.push(`${relativePath(root, indexPath)}: collection index is missing`)

    const uniqueValues = new Map<string, Map<string, string>>()
    const generatedPairs = new Set<string>()
    for (const source of sources) {
      const sourceMarkdown = parsed.get(source) ?? inspectMarkdown(source)
      const display = relativePath(root, source)
      if (indexPath && indexMarkdown && linkCount(root, indexPath, indexMarkdown, source) !== 1) {
        errors.push(`${display}: expected exactly one link in ${relativePath(root, indexPath)}`)
      }

      for (const [field, rule] of Object.entries(collection.metadata ?? {})) {
        const rawValue = sourceMarkdown.metadata.get(field)
        if (!rawValue) {
          errors.push(`${display}: missing required metadata: ${field}`)
          continue
        }
        const value = rawValue.replaceAll('`', '').trim()
        if (rule.equals !== undefined && value !== interpolate(rule.equals, source)) errors.push(`${display}: ${field} must equal ${interpolate(rule.equals, source)}`)
        if (rule.unique) {
          const values = uniqueValues.get(field) ?? new Map<string, string>()
          const previous = values.get(value)
          if (previous) errors.push(`${display}: duplicate ${field} with ${previous}: ${value}`)
          else values.set(value, display)
          uniqueValues.set(field, values)
        }
        if (rule.repositoryPaths) {
          const references = [...rawValue.matchAll(/`([^`]+)`/gu)].map((match) => match[1])
          if (references.length < (rule.minItems ?? 1)) errors.push(`${display}: ${field} requires at least ${rule.minItems ?? 1} repository path(s)`)
          for (const reference of references) {
            const target = resolve(root, reference)
            if (!isInsideRoot(root, target) || !existsSync(target)) errors.push(`${display}: missing repository path in ${field}: ${reference}`)
          }
        }
      }

      const pair = collection.pairedDocuments
      if (!pair) continue
      const target = resolve(root, interpolate(pair.target, source))
      generatedPairs.add(target)
      if (linkCount(root, source, sourceMarkdown, target) !== 1) errors.push(`${display}: expected exactly one link to ${relativePath(root, target)}`)
      if (!existsSync(target)) {
        errors.push(`${relativePath(root, target)}: paired document is missing`)
        continue
      }
      const targetMarkdown = parsed.get(target) ?? inspectMarkdown(target)
      if (pair.index) {
        const pairIndex = resolve(root, pair.index)
        if (!existsSync(pairIndex) || linkCount(root, pairIndex, inspectMarkdown(pairIndex), target) !== 1) {
          errors.push(`${relativePath(root, target)}: expected exactly one link in ${relativePath(root, pairIndex)}`)
        }
      }
      errors.push(...validatePairContent(root, target, targetMarkdown, pair))
    }

    const pair = collection.pairedDocuments
    if (pair) {
      const pairDirectory = resolve(root, dirname(pair.target))
      const pairIndex = pair.index ? resolve(root, pair.index) : undefined
      for (const file of documentFiles.filter((candidate) => dirname(candidate) === pairDirectory && candidate !== pairIndex)) {
        if (!generatedPairs.has(file)) errors.push(`${relativePath(root, file)}: paired document has no source document`)
      }
    }
  }

  for (const inventory of config.inventories ?? []) {
    const inventoryPath = resolve(root, inventory.document)
    if (!existsSync(inventoryPath)) {
      errors.push(`${normalizePath(inventory.document)}: inventory document is missing`)
      continue
    }
    const sources = allFiles.filter((file) => matches(relativeFiles.get(file) ?? '', inventory.sources))
    if (sources.length < (inventory.minMatches ?? 0)) errors.push(`${normalizePath(inventory.document)}: inventory requires at least ${inventory.minMatches ?? 0} source match(es)`)
    const content = readFileSync(inventoryPath, 'utf8')
    for (const source of sources) {
      const display = relativeFiles.get(source) ?? relativePath(root, source)
      if (!content.includes(`\`${display}\``)) errors.push(`${normalizePath(inventory.document)}: source is not inventoried: ${display}`)
    }
  }

  return errors.sort()
}

async function main(): Promise<void> {
  const { config, configPath } = await loadConfig(process.cwd())
  if (!configPath || !config.documentation) throw new Error('documentation is not configured in .webtoolkit-cli/config.json.')
  const root = dirname(dirname(configPath))
  const errors = checkDocumentation(root, config.documentation)
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exitCode = 1
    return
  }
  console.info('Documentation is valid.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error((error as Error).message)
    process.exitCode = 1
  })
}
