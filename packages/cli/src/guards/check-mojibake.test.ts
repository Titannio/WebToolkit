import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyWordReplacements,
  applyFixPlans,
  buildFileFixPlan,
  buildLinePreview,
  collectFindings,
  extractAffectedWordInfo,
  parseCliOptions,
  resolveReplacementWord,
  runMojibakeGuard,
  shouldScanFile,
  verifyAndCleanupBackups,
} from './check-mojibake.js'

const roots: string[] = []

async function fixture(content: string, file = 'source.ts'): Promise<{ root: string; filePath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-mojibake-'))
  roots.push(root)
  const filePath = path.join(root, file)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return { root, filePath }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('mojibake guard', () => {
  it('accepts clean files and ignores artifacts and unsupported extensions', async () => {
    const clean = await fixture('export const greeting = "Olá"')
    await mkdir(path.join(clean.root, 'dist'), { recursive: true })
    await writeFile(path.join(clean.root, 'dist', 'broken.ts'), 'OlÃ¡', 'utf8')
    await writeFile(path.join(clean.root, 'binary.bin'), 'OlÃ¡', 'utf8')
    await mkdir(path.join(clean.root, 'nested'), { recursive: true })
    await writeFile(path.join(clean.root, 'nested', 'clean.ts'), 'export {}', 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(runMojibakeGuard([], clean.root)).toBe(0)
  })

  it('reports scan-only findings without changing the file', async () => {
    const broken = await fixture('export const greeting = "OlÃ¡"')
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(runMojibakeGuard([], broken.root)).toBe(1)
    expect(await readFile(broken.filePath, 'utf8')).toContain('OlÃ¡')
    expect(info.mock.calls.flat().join('\n')).toContain('source.ts')
  })

  it('previews fixes in dry-run and changes files only with explicit fix mode', async () => {
    const broken = await fixture('export const greeting = "OlÃ¡, JoÃ£o"')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(runMojibakeGuard(['--fix', '--dry-run'], broken.root)).toBe(1)
    expect(await readFile(broken.filePath, 'utf8')).toContain('OlÃ¡')

    expect(runMojibakeGuard(['--fix'], broken.root)).toBe(0)
    expect(await readFile(broken.filePath, 'utf8')).toContain('Olá')
    expect(await readFile(broken.filePath, 'utf8')).toContain('João')
  })

  it('keeps replacement characters for manual review', async () => {
    const manual = await fixture('export const greeting = "Ol�"')
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(runMojibakeGuard(['--fix'], manual.root)).toBe(1)
    expect(await readFile(manual.filePath, 'utf8')).toContain('�')
    expect(info.mock.calls.flat().join('\n')).toContain('revisao manual')
  })

  it('covers CLI parsing, file filtering, word extraction, and previews', () => {
    expect(parseCliOptions(['--fix', '--dry-run'])).toEqual({ fix: true, dryRun: true })
    expect(parseCliOptions([])).toEqual({ fix: false, dryRun: false })
    expect(shouldScanFile('SOURCE.TSX')).toBe(true)
    expect(shouldScanFile('image.png')).toBe(false)
    expect(shouldScanFile('check-mojibake.ts')).toBe(false)
    expect(extractAffectedWordInfo('prefix OlÃ¡ suffix', 7, 2)).toMatchObject({ word: 'OlÃ¡', wordStart: 7 })
    expect(buildLinePreview('short')).toBe('short')
    expect(buildLinePreview('x'.repeat(300))).toHaveLength(220)
  })

  it('classifies conservative replacements and guards replacement application', async () => {
    expect(resolveReplacementWord('OlÃ¡')).toEqual({ replacementWord: 'Olá', skipReason: null })
    expect(resolveReplacementWord('Ol�')).toMatchObject({ replacementWord: null })
    expect(resolveReplacementWord('ÃƒÂ¡')).toMatchObject({ replacementWord: null })
    expect(resolveReplacementWord('plain')).toMatchObject({ replacementWord: null })
    expect(resolveReplacementWord(`OlÃ¡\u007f`)).toMatchObject({
      replacementWord: null,
      skipReason: expect.stringContaining('controle'),
    })
    expect(resolveReplacementWord('Â')).toMatchObject({
      replacementWord: null,
      skipReason: expect.stringContaining('suspeitos'),
    })
    const broken = await fixture('OlÃ¡')
    const [finding] = collectFindings(broken.filePath, 'OlÃ¡', broken.root)
    expect(applyWordReplacements('OlÃ¡', [finding])).toBe('Olá')
    expect(() => applyWordReplacements('changed', [finding])).toThrow('trecho esperado')
    expect(() => applyWordReplacements('OlÃ¡', [{ ...finding, replacementWord: null }])).toThrow('sem replacementWord')
  })

  it('caps large finding sets and tracks CRLF offsets', async () => {
    const broken = await fixture('')
    const content = `${Array.from({ length: 205 }, () => 'OlÃ¡').join(' ')}\r\nOlÃ¡`
    const findings = collectFindings(broken.filePath, content, broken.root)
    expect(findings).toHaveLength(200)
    expect(findings[0].absoluteWordStart).toBe(0)
    expect(collectFindings(broken.filePath, 'OlÃ¡\r\nOlÃ¡\nOlÃ¡', broken.root))
      .toHaveLength(3)
    expect(collectFindings(
      broken.filePath,
      Array.from({ length: 200 }, () => 'OlÃ¡').join('\n'),
      broken.root,
    )).toHaveLength(200)
  })

  it('deduplicates repeated suspicious snippets within one affected word', async () => {
    const broken = await fixture('Ã¡Ã¡Ã£')
    const findings = collectFindings(broken.filePath, 'Ã¡Ã¡Ã£', broken.root)
    expect(findings).toHaveLength(1)
    expect(findings[0].snippets).toEqual(['Ã¡', 'Ã£'])
  })

  it('reports remaining manual findings after applying safe fixes', async () => {
    const mixed = await fixture('OlÃ¡ e Ol�')
    await writeFile(path.join(mixed.root, 'clean.ts'), 'export {}', 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(runMojibakeGuard(['--fix'], mixed.root)).toBe(1)
    expect(await readFile(mixed.filePath, 'utf8')).toBe('Olá e Ol�')
  })

  it('caps aggregate findings across files', async () => {
    const first = await fixture('')
    for (let index = 0; index < 201; index += 1) {
      await writeFile(path.join(first.root, `broken-${index}.ts`), 'OlÃ¡', 'utf8')
    }
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(runMojibakeGuard([], first.root)).toBe(1)
  })

  it('verifies temporary backups and keeps unverifiable ones', async () => {
    const broken = await fixture('OlÃ¡')
    const content = await readFile(broken.filePath, 'utf8')
    const findings = collectFindings(broken.filePath, content, broken.root)
    const plan = buildFileFixPlan(broken.filePath, content, findings, broken.root)
    if (!plan) throw new Error('Expected fix plan')

    const backupRoot = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-mojibake-test-backup-'))
    roots.push(backupRoot)
    applyFixPlans([plan], backupRoot)
    expect(() => applyFixPlans([plan], backupRoot)).toThrow('Backup ja existe')
    expect(verifyAndCleanupBackups([plan], backupRoot).deletedBackups).toHaveLength(1)

    const missingBackupRoot = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-mojibake-test-backup-'))
    roots.push(missingBackupRoot)
    expect(verifyAndCleanupBackups([plan], missingBackupRoot).keptBackups).toHaveLength(1)

    const mismatchedRoot = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-mojibake-test-backup-'))
    roots.push(mismatchedRoot)
    await writeFile(broken.filePath, content, 'utf8')
    applyFixPlans([plan], mismatchedRoot)
    await writeFile(broken.filePath, 'externally changed', 'utf8')
    expect(verifyAndCleanupBackups([plan], mismatchedRoot).keptBackups).toHaveLength(1)
  })
})
