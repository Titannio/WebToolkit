// @ts-nocheck
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

const ROOT = process.cwd()
const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.scss', '.html', '.yml', '.yaml'])
const SKIP_DIRS = new Set(['node_modules', '.git', '.turbo', 'dist', 'build', 'coverage', '.next'])
const MAX_FINDINGS = 200
const LINE_PREVIEW_LIMIT = 220
const AUTO_FIXABLE_PREFIX_PATTERN = /[\u00C2\u00C3][\u0080-\u00BF]/
const DOUBLE_ENCODED_PATTERN = /\u00C3\u0192\u00C2/
const REPLACEMENT_CHAR_PATTERN = /\uFFFD/
const BACKUP_ROOT_PREFIX = 'doutory-mojibake-backup-'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
}

const suspiciousPatterns: Array<{ regex: RegExp; reason: string }> = [
  { regex: /\u00C3\u0192\u00C2/g, reason: 'Dupla corrupção de encoding detectada' },
  { regex: /\u00C3[\u0080-\u00BF]/g, reason: 'UTF-8 texto lido como Latin-1 (prefixo U+00C3)' },
  { regex: /\u00C2[\u0080-\u00BF]/g, reason: 'UTF-8 texto lido como Latin-1 (prefixo U+00C2)' },
  { regex: /\uFFFD/g, reason: 'Caractere de substituição encontrado' },
]

type Finding = {
  file: string
  absoluteFile: string
  lineNumber: number
  lineText: string
  reason: string
  snippets: string[]
  affectedWord: string
  wordStart: number
  wordEnd: number
  absoluteWordStart: number
  absoluteWordEnd: number
  replacementWord: string | null
  autoFixStatus: 'fixable' | 'manual'
  skipReason: string | null
}

type FileFixPlan = {
  absoluteFile: string
  relativeFile: string
  originalContent: string
  updatedContent: string
  appliedFixes: Finding[]
  skippedFindings: Finding[]
}

type CliOptions = {
  fix: boolean
  dryRun: boolean
}

type ScanResult = {
  findings: Finding[]
  findingsByFile: Map<string, Finding[]>
}

type BackupCleanupResult = {
  deletedBackups: string[]
  keptBackups: string[]
  backupRoot: string
}

function parseCliOptions(argv: string[]): CliOptions {
  const args = new Set(argv)
  return {
    fix: args.has('--fix'),
    dryRun: args.has('--dry-run'),
  }
}

function shouldScanFile(filePath: string): boolean {
  if (filePath.endsWith('check-mojibake.ts')) return false
  const lower = filePath.toLowerCase()
  for (const ext of ALLOWED_EXTENSIONS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

function walk(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const st = statSync(fullPath)
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(fullPath, files)
      continue
    }
    if (st.isFile() && shouldScanFile(fullPath)) files.push(fullPath)
  }
}

function isWordBoundary(char: string | undefined): boolean {
  if (!char) return true
  return /[\s"'`.,;:!?()[\]{}<>/=+\\|]/.test(char)
}

function extractAffectedWordInfo(line: string, start: number, length: number): { word: string; wordStart: number; wordEnd: number } {
  let wordStart = start
  let wordEnd = start + length

  while (wordStart > 0 && !isWordBoundary(line[wordStart - 1])) {
    wordStart -= 1
  }

  while (wordEnd < line.length && !isWordBoundary(line[wordEnd])) {
    wordEnd += 1
  }

  const word = line.slice(wordStart, wordEnd).trim()
  if (word.length > 0) {
    return { word, wordStart, wordEnd }
  }

  return {
    word: line.slice(start, start + length),
    wordStart: start,
    wordEnd: start + length,
  }
}

function buildLinePreview(line: string): string {
  const normalized = line.replace(/\t/g, '  ').trimEnd()
  if (normalized.length <= LINE_PREVIEW_LIMIT) return normalized
  return `${normalized.slice(0, LINE_PREVIEW_LIMIT - 3)}...`
}

function containsSuspiciousContent(value: string): boolean {
  return suspiciousPatterns.some(({ regex }) => {
    regex.lastIndex = 0
    return regex.test(value)
  })
}

function containsUnsafeControlChars(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
}

function resolveReplacementWord(word: string): { replacementWord: string | null; skipReason: string | null } {
  if (REPLACEMENT_CHAR_PATTERN.test(word)) {
    return { replacementWord: null, skipReason: 'contem caractere de substituicao; auto-fix bloqueado' }
  }

  if (DOUBLE_ENCODED_PATTERN.test(word)) {
    return { replacementWord: null, skipReason: 'contem dupla corrupcao; auto-fix de uma passada bloqueado' }
  }

  if (!AUTO_FIXABLE_PREFIX_PATTERN.test(word)) {
    return { replacementWord: null, skipReason: 'fora do padrao conservador de palavra inteira' }
  }

  const replacementWord = Buffer.from(word, 'latin1').toString('utf8')
  if (replacementWord.length === 0 || replacementWord === word) {
    return { replacementWord: null, skipReason: 'a conversao nao produziu uma palavra diferente' }
  }

  if (containsUnsafeControlChars(replacementWord)) {
    return { replacementWord: null, skipReason: 'a correção gerou caracteres de controle' }
  }

  if (containsSuspiciousContent(replacementWord)) {
    return { replacementWord: null, skipReason: 'a palavra corrigida ainda contem marcadores suspeitos' }
  }

  const roundTrip = Buffer.from(replacementWord, 'utf8').toString('latin1')
  if (roundTrip !== word) {
    return { replacementWord: null, skipReason: 'a correção falhou na validação reversivel utf8->latin1' }
  }

  if (replacementWord.includes('\r') || replacementWord.includes('\n')) {
    return { replacementWord: null, skipReason: 'a correção alteraria a estrutura de linhas' }
  }

  return { replacementWord, skipReason: null }
}

function collectFindings(file: string, content: string): Finding[] {
  const fileFindings: Finding[] = []
  const lines = content.split(/\r?\n/)
  let lineStartOffset = 0

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const lineFindings = new Map<string, Finding>()

    for (const { regex, reason } of suspiciousPatterns) {
      regex.lastIndex = 0

      for (const match of line.matchAll(regex)) {
        const snippet = match[0]
        const start = match.index ?? 0
        const affected = extractAffectedWordInfo(line, start, snippet.length)
        const findingKey = `${lineIndex}:${affected.wordStart}:${affected.wordEnd}:${reason}`
        const existingFinding = lineFindings.get(findingKey)

        if (existingFinding) {
          if (!existingFinding.snippets.includes(snippet)) {
            existingFinding.snippets.push(snippet)
          }
          continue
        }

        const replacement = resolveReplacementWord(affected.word)

        lineFindings.set(findingKey, {
          file: relative(ROOT, file),
          absoluteFile: file,
          lineNumber: lineIndex + 1,
          lineText: buildLinePreview(line),
          reason,
          snippets: [snippet],
          affectedWord: affected.word,
          wordStart: affected.wordStart,
          wordEnd: affected.wordEnd,
          absoluteWordStart: lineStartOffset + affected.wordStart,
          absoluteWordEnd: lineStartOffset + affected.wordEnd,
          replacementWord: replacement.replacementWord,
          autoFixStatus: replacement.replacementWord ? 'fixable' : 'manual',
          skipReason: replacement.skipReason,
        })

        if (fileFindings.length + lineFindings.size >= MAX_FINDINGS) {
          fileFindings.push(...lineFindings.values())
          return fileFindings.slice(0, MAX_FINDINGS)
        }
      }
    }

    fileFindings.push(...lineFindings.values())
    if (fileFindings.length >= MAX_FINDINGS) return fileFindings.slice(0, MAX_FINDINGS)

    const lineEndOffset = lineStartOffset + line.length
    const nextChars = content.slice(lineEndOffset, lineEndOffset + 2)
    const lineBreakLength = nextChars.startsWith('\r\n') ? 2 : nextChars.startsWith('\n') ? 1 : 0
    lineStartOffset = lineEndOffset + lineBreakLength
  }

  return fileFindings
}

function applyWordReplacements(content: string, fixes: Finding[]): string {
  const fixesDescending = [...fixes].sort((left, right) => right.absoluteWordStart - left.absoluteWordStart)
  let updatedContent = content

  for (const finding of fixesDescending) {
    if (!finding.replacementWord) {
      throw new Error(`Fix sem replacementWord em ${finding.file}:${finding.lineNumber}`)
    }

    const currentWord = updatedContent.slice(finding.absoluteWordStart, finding.absoluteWordEnd)
    if (currentWord !== finding.affectedWord) {
      throw new Error(`O trecho esperado para correção mudou em ${finding.file}:${finding.lineNumber}`)
    }

    updatedContent = `${updatedContent.slice(0, finding.absoluteWordStart)}${finding.replacementWord}${updatedContent.slice(finding.absoluteWordEnd)}`
  }

  return updatedContent
}

function buildFileFixPlan(filePath: string, content: string, findings: Finding[]): FileFixPlan | null {
  const fixableFindings = findings
    .filter((finding) => finding.autoFixStatus === 'fixable' && finding.replacementWord !== null)
    .sort((left, right) => left.absoluteWordStart - right.absoluteWordStart)

  if (fixableFindings.length === 0) return null

  const updatedContent = applyWordReplacements(content, fixableFindings)
  const remainingFindings = collectFindings(filePath, updatedContent)
  const unresolvedFixedWords = fixableFindings.filter((finding) =>
    remainingFindings.some((remaining) =>
      remaining.lineNumber === finding.lineNumber &&
      remaining.affectedWord === finding.replacementWord,
    ),
  )

  if (unresolvedFixedWords.length > 0) {
    return null
  }

  return {
    absoluteFile: filePath,
    relativeFile: relative(ROOT, filePath),
    originalContent: content,
    updatedContent,
    appliedFixes: fixableFindings,
    skippedFindings: findings.filter((finding) => finding.autoFixStatus === 'manual'),
  }
}

function buildFixPlans(files: string[], findingsByFile: Map<string, Finding[]>): FileFixPlan[] {
  const plans: FileFixPlan[] = []

  for (const file of files) {
    const findings = findingsByFile.get(file)
    if (!findings || findings.length === 0) continue

    const content = readFileSync(file, 'utf8')
    const plan = buildFileFixPlan(file, content, findings)
    if (plan) {
      plans.push(plan)
    }
  }

  return plans
}

function createBackupRoot(): string {
  return mkdtempSync(join(tmpdir(), BACKUP_ROOT_PREFIX))
}

function getBackupPath(backupRoot: string, relativeFile: string): string {
  return join(backupRoot, relativeFile)
}

function applyFixPlans(plans: FileFixPlan[], backupRoot: string): void {
  for (const plan of plans) {
    const backupPath = getBackupPath(backupRoot, plan.relativeFile)
    mkdirSync(dirname(backupPath), { recursive: true })

    if (existsSync(backupPath)) {
      throw new Error(`Backup ja existe para ${plan.relativeFile}: ${backupPath}`)
    }

    writeFileSync(backupPath, plan.originalContent, 'utf8')
    writeFileSync(plan.absoluteFile, plan.updatedContent, 'utf8')

    const rewrittenContent = readFileSync(plan.absoluteFile, 'utf8')
    if (rewrittenContent !== plan.updatedContent) {
      writeFileSync(plan.absoluteFile, plan.originalContent, 'utf8')
      throw new Error(`Falha na verificação pos-gravação para ${plan.relativeFile}; arquivo original restaurado`)
    }
  }
}

function verifyAndCleanupBackups(plans: FileFixPlan[], backupRoot: string): BackupCleanupResult {
  const deletedBackups: string[] = []
  const keptBackups: string[] = []

  for (const plan of plans) {
    const backupPath = getBackupPath(backupRoot, plan.relativeFile)

    if (!existsSync(backupPath)) {
      keptBackups.push(backupPath)
      continue
    }

    const backupContent = readFileSync(backupPath, 'utf8')
    const actualContent = readFileSync(plan.absoluteFile, 'utf8')
    const expectedContent = applyWordReplacements(backupContent, plan.appliedFixes)

    if (backupContent !== plan.originalContent || actualContent !== expectedContent) {
      keptBackups.push(backupPath)
      continue
    }

    unlinkSync(backupPath)
    deletedBackups.push(backupPath)
  }

  if (keptBackups.length === 0) {
    rmSync(backupRoot, { recursive: true, force: true })
  }

  return { deletedBackups, keptBackups, backupRoot }
}

function formatFinding(item: Finding): string {
  const fixSuffix = item.autoFixStatus === 'fixable' && item.replacementWord
    ? ` | auto-fix "${item.replacementWord}"`
    : ` | sem auto-fix: ${item.skipReason}`

  return `- ${item.file}:${item.lineNumber}: palavra "${item.affectedWord}" | matches "${item.snippets.join(', ')}" | ${item.reason}${fixSuffix}`
}

function scanFiles(files: string[]): ScanResult {
  const findings: Finding[] = []
  const findingsByFile = new Map<string, Finding[]>()

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const fileFindings = collectFindings(file, content)

    if (fileFindings.length > 0) {
      findingsByFile.set(file, fileFindings)
      findings.push(...fileFindings)
    }

    if (findings.length >= MAX_FINDINGS) break
  }

  return { findings, findingsByFile }
}

function reportFindings(findings: Finding[], mode: 'scan' | 'fix' | 'post-fix'): void {
  const fixableFindings = findings.filter((finding) => finding.autoFixStatus === 'fixable')
  const manualFindings = findings.filter((finding) => finding.autoFixStatus === 'manual')
  const headline = mode === 'fix'
    ? `INFO ${colors.yellow}[Encontrados]${colors.reset}: ${findings.length} indicio(s) de mojibake localizados antes da correcao.`
    : `FAIL ${colors.red}[Falha]${colors.reset}: ${findings.length} indicio(s) de mojibake encontrados.`

  console.info(headline)
  console.info(`INFO ${colors.cyan}[Resumo]${colors.reset}: ${fixableFindings.length} ocorrencia(s) com auto-fix conservador; ${manualFindings.length} ocorrencia(s) exigem revisao manual.`)

  for (const item of findings) {
    console.info(formatFinding(item))
    console.info(`  linha: ${item.lineText}`)
  }
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2))
  const files: string[] = []
  walk(ROOT, files)

  const initialScan = scanFiles(files)

  if (initialScan.findings.length === 0) {
    console.info(`OK ${colors.green}${colors.bright}[OK]${colors.reset}: Nenhum indicio de mojibake encontrado.`)
    return
  }

  reportFindings(initialScan.findings, options.fix ? 'fix' : 'scan')

  if (!options.fix) {
    process.exit(1)
  }

  const plans = buildFixPlans(files, initialScan.findingsByFile)
  const appliedFixCount = plans.reduce((count, plan) => count + plan.appliedFixes.length, 0)

  if (plans.length === 0 || appliedFixCount === 0) {
    console.info(`INFO ${colors.yellow}[Auto-fix]${colors.reset}: Nenhuma correção automatica elegivel foi aplicada.`)
    process.exit(1)
  }

  console.info(`INFO ${colors.yellow}[Auto-fix]${colors.reset}: ${appliedFixCount} palavra(s) elegivel(is) em ${plans.length} arquivo(s).`)
  for (const plan of plans) {
    for (const fix of plan.appliedFixes) {
      console.info(`  ${plan.relativeFile}:${fix.lineNumber}: "${fix.affectedWord}" -> "${fix.replacementWord}"`)
    }
  }

  if (options.dryRun) {
    console.info(`INFO ${colors.yellow}[Dry-run]${colors.reset}: Nenhum arquivo foi alterado.`)
    process.exit(1)
  }

  const backupRoot = createBackupRoot()

  try {
    applyFixPlans(plans, backupRoot)

    const cleanupResult = verifyAndCleanupBackups(plans, backupRoot)
    if (cleanupResult.deletedBackups.length > 0) {
      console.info(`INFO ${colors.cyan}[Backups]${colors.reset}: ${cleanupResult.deletedBackups.length} backup(s) temporario(s) removido(s) apos verificacao.`)
    }
    if (cleanupResult.keptBackups.length > 0) {
      console.info(`INFO ${colors.yellow}[Backups]${colors.reset}: ${cleanupResult.keptBackups.length} backup(s) mantido(s) em ${cleanupResult.backupRoot}.`)
    }

    const postFixScan = scanFiles(files)
    if (postFixScan.findings.length === 0) {
      console.info(`OK ${colors.green}${colors.bright}[Auto-fix aplicado]${colors.reset}: correcoes gravadas e backups temporarios verificados.`)
      process.exit(0)
    }

    console.info(`INFO ${colors.yellow}[Pos-fix]${colors.reset}: ainda restam ocorrencias que exigem nova execução ou revisao manual.`)
    reportFindings(postFixScan.findings, 'post-fix')
    process.exit(1)
  } catch (error) {
    console.error(`FAIL ${colors.red}[Erro]${colors.reset}: ${(error as Error).message}`)
    console.error(`INFO ${colors.yellow}[Backups]${colors.reset}: backups desta execução foram mantidos em ${backupRoot}.`)
    process.exit(1)
  }
}

main()
