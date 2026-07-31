import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

import type { BundleBudgetConfig, BundleEntryBudgetConfig, WebToolkitCliConfig } from './config.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

type BundleAsset = {
  app: string
  file: string
  rawBytes: number
  gzipBytes: number
  brotliBytes: number
}

type AppBundleStats = {
  app: string
  assetsDir: string
  statsHtmlPath: string
  statsHtmlExists: boolean
  assets: BundleAsset[]
}

type EntryBundleStats = {
  files: string[]
  rawBytes: number
  gzipBytes: number
  brotliBytes: number
  missingFiles: string[]
}

type CompiledBundleBudget = BundleBudgetConfig & {
  matcher: RegExp
}

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
}

const assetExtensions = new Set(['.js', '.css'])
const entryLinkRelations = new Set(['modulepreload', 'stylesheet'])

function colorize(value: string, color: string): string {
  return `${color}${value}${colors.reset}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(1)} KiB`
  return `${(kib / 1024).toFixed(2)} MiB`
}

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ')
}

function compareAssetsByRawSizeDesc(left: BundleAsset, right: BundleAsset): number {
  return right.rawBytes - left.rawBytes || left.app.localeCompare(right.app) || left.file.localeCompare(right.file)
}

function collectBundleAssets(rootDir: string, appDirs: string[]): AppBundleStats[] {
  return appDirs.map((appDir) => {
    const distDir = join(rootDir, appDir, 'dist')
    const assetsDir = join(distDir, 'assets')
    const statsHtmlPath = join(distDir, 'stats.html')

    if (!existsSync(assetsDir)) {
      return { app: appDir, assetsDir, statsHtmlPath, statsHtmlExists: existsSync(statsHtmlPath), assets: [] }
    }

    const assets = readdirSync(assetsDir)
      .filter((file) => assetExtensions.has(extname(file)))
      .map((file) => {
        const fullPath = join(assetsDir, file)
        const content = readFileSync(fullPath)
        return {
          app: appDir,
          file,
          rawBytes: statSync(fullPath).size,
          gzipBytes: gzipSync(content).length,
          brotliBytes: brotliCompressSync(content).length,
        }
      })
      .sort(compareAssetsByRawSizeDesc)

    return { app: appDir, assetsDir, statsHtmlPath, statsHtmlExists: existsSync(statsHtmlPath), assets }
  })
}

function assertConfiguredBudgetApps(
  appDirs: string[],
  budgets: Array<BundleBudgetConfig | BundleEntryBudgetConfig>,
): void {
  const configuredApps = new Set(appDirs)
  for (const budget of budgets) {
    if (!configuredApps.has(budget.appDir)) {
      throw new Error(`Bundle budget "${budget.label}" references appDir "${budget.appDir}" outside bundleAudit.appDirs.`)
    }
  }
}

function compileBundleBudgets(appDirs: string[], budgets: BundleBudgetConfig[]): CompiledBundleBudget[] {
  assertConfiguredBudgetApps(appDirs, budgets)
  return budgets.map((budget) => {
    return {
      ...budget,
      matcher: new RegExp(budget.pattern, 'u'),
    }
  })
}

function readAttribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'iu'))?.[1]
}

function collectEntryReferences(html: string): string[] {
  const references = new Set<string>()
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/giu)) {
    const [, kind] = match
    const tag = match[0]
    if (kind.toLowerCase() === 'script') {
      const src = readAttribute(tag, 'src')
      if (src) references.add(src)
      continue
    }

    const relations = readAttribute(tag, 'rel')?.toLowerCase().split(/\s+/u) ?? []
    if (!relations.some((relation) => entryLinkRelations.has(relation))) continue
    const href = readAttribute(tag, 'href')
    if (href) references.add(href)
  }
  return [...references]
}

function resolveLocalEntryAsset(distDir: string, reference: string): string | undefined {
  const withoutQuery = reference.split(/[?#]/u, 1)[0]
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//iu.test(withoutQuery) || withoutQuery.startsWith('data:')) {
    return undefined
  }

  const filePath = resolve(distDir, decodeURIComponent(withoutQuery.replace(/^\/+/u, '')))
  const relativePath = relative(distDir, filePath)
  if (relativePath.startsWith('..') || resolve(distDir, relativePath) !== filePath) {
    throw new Error(`Entrypoint asset "${reference}" resolves outside ${distDir}.`)
  }
  return filePath
}

function collectEntryBundleStats(rootDir: string, appDir: string): EntryBundleStats {
  const distDir = join(rootDir, appDir, 'dist')
  const indexHtmlPath = join(distDir, 'index.html')
  if (!existsSync(indexHtmlPath)) {
    return {
      files: [],
      rawBytes: 0,
      gzipBytes: 0,
      brotliBytes: 0,
      missingFiles: [indexHtmlPath],
    }
  }

  const files = collectEntryReferences(readFileSync(indexHtmlPath, 'utf8'))
    .map((reference) => resolveLocalEntryAsset(distDir, reference))
    .filter((file): file is string => file !== undefined)
  const missingFiles = files.filter((file) => !existsSync(file))
  const contents = files.filter((file) => existsSync(file)).map((file) => readFileSync(file))

  return {
    files,
    rawBytes: contents.reduce((total, content) => total + content.length, 0),
    gzipBytes: contents.reduce((total, content) => total + gzipSync(content).length, 0),
    brotliBytes: contents.reduce((total, content) => total + brotliCompressSync(content).length, 0),
    missingFiles,
  }
}

export function runBundleAudit(runtime: Runtime, rawArgs: string[]): void {
  const config = runtime.config.bundleAudit
  if (!config?.appDirs?.length) {
    throw new Error('bundleAudit.appDirs is not configured.')
  }

  const args = new Map<string, string>()
  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index]
    if (!token.startsWith('--')) continue
    const [key, value] = token.slice(2).split('=', 2)
    if (value !== undefined) args.set(key, value)
    else if (rawArgs[index + 1] && !rawArgs[index + 1].startsWith('--')) {
      args.set(key, rawArgs[index + 1])
      index += 1
    }
  }

  const rootDir = resolve(args.get('root') ?? runtime.cwd)
  const top = Number(args.get('top') ?? String(config.top ?? 20))
  const rawWarningBytes = config.rawWarningBytes ?? 1_000_000
  const budgets = compileBundleBudgets(config.appDirs, config.budgets ?? [])
  const entryBudgets = config.entryBudgets ?? []
  assertConfiguredBudgetApps(config.appDirs, entryBudgets)
  const stats = collectBundleAssets(rootDir, config.appDirs)
  const allAssets = stats.flatMap((entry) => entry.assets).sort(compareAssetsByRawSizeDesc)

  console.info(colorize('Frontend bundle audit', `${colors.bright}${colors.cyan}`))
  console.info('')
  console.info(colorize('Apps:', colors.bright))
  for (const entry of stats) {
    const relativeAssetsDir = relative(process.cwd(), entry.assetsDir) || entry.assetsDir
    const relativeStatsPath = relative(process.cwd(), entry.statsHtmlPath) || entry.statsHtmlPath
    const statsStatus = entry.statsHtmlExists ? colorize('stats.html ok', colors.green) : colorize('stats.html missing', colors.yellow)
    console.info(`- ${colorize(entry.app, colors.cyan)}: ${entry.assets.length} JS/CSS assets, ${statsStatus} (${relativeAssetsDir}; ${relativeStatsPath})`)
  }

  console.info('')
  const hasNoAssets = allAssets.length === 0
  if (allAssets.length === 0) {
    console.info(colorize('No JS/CSS bundle assets found. Run the frontend builds before auditing.', colors.yellow))
  } else {
    console.info(colorize(`Top ${Math.min(top, allAssets.length)} assets by raw size:`, colors.bright))
    console.info(colorize([' ', pad('app', 28), pad('file', 54), pad('raw', 10), pad('gzip', 10), 'brotli'].join('  '), colors.gray))
    for (const asset of allAssets.slice(0, top)) {
      const marker = asset.rawBytes >= rawWarningBytes ? '!' : ' '
      const line = [
        marker,
        pad(asset.app, 28),
        pad(asset.file, 54),
        pad(formatBytes(asset.rawBytes), 10),
        pad(formatBytes(asset.gzipBytes), 10),
        formatBytes(asset.brotliBytes),
      ].join('  ')
      console.info(asset.rawBytes >= rawWarningBytes ? colorize(line, colors.red) : line)
    }

    const warnedCount = allAssets.filter((asset) => asset.rawBytes >= rawWarningBytes).length
    console.info('')
    console.info(colorize(`Warning threshold: ${formatBytes(rawWarningBytes)} raw. Flagged assets: ${warnedCount}.`, warnedCount > 0 ? colors.yellow : colors.green))
  }

  if (budgets.length === 0 && entryBudgets.length === 0) {
    if (hasNoAssets) process.exitCode = 1
    return
  }

  let hasBudgetFailure = hasNoAssets
  if (budgets.length > 0) {
    console.info('')
    console.info(colorize('Bundle budgets:', colors.bright))
    for (const budget of budgets) {
      const appAssets = stats.find((entry) => entry.app === budget.appDir)!.assets
      const matches = appAssets.filter((asset) => budget.matcher.test(asset.file))

      if (matches.length === 0) {
        const required = budget.required ?? true
        const status = required ? 'MISSING' : 'SKIP'
        console.info(colorize(
          `- ${status} ${budget.appDir} ${budget.label}: no asset matched ${budget.pattern}`,
          required ? colors.red : colors.yellow,
        ))
        if (required) hasBudgetFailure = true
        continue
      }

      for (const asset of matches) {
        const passed = asset.rawBytes <= budget.maxRawBytes
        const status = passed ? 'PASS' : 'FAIL'
        console.info(colorize(
          `- ${status} ${budget.appDir} ${budget.label}: ${asset.file} ${formatBytes(asset.rawBytes)} <= ${formatBytes(budget.maxRawBytes)}`,
          passed ? colors.green : colors.red,
        ))
        if (!passed) hasBudgetFailure = true
      }
    }
  }

  if (entryBudgets.length > 0) {
    const entryStats = new Map(
      [...new Set(entryBudgets.map((budget) => budget.appDir))]
        .map((appDir) => [appDir, collectEntryBundleStats(rootDir, appDir)]),
    )
    console.info('')
    console.info(colorize('Entrypoint budgets:', colors.bright))
    for (const budget of entryBudgets) {
      const entry = entryStats.get(budget.appDir)!
      if (entry.missingFiles.length > 0) {
        console.info(colorize(
          `- MISSING ${budget.appDir} ${budget.label}: ${entry.missingFiles.join(', ')}`,
          colors.red,
        ))
        hasBudgetFailure = true
        continue
      }

      const passed = entry.brotliBytes <= budget.maxBrotliBytes
      const status = passed ? 'PASS' : 'FAIL'
      console.info(colorize(
        `- ${status} ${budget.appDir} ${budget.label}: ${entry.files.length} assets, raw ${formatBytes(entry.rawBytes)}, gzip ${formatBytes(entry.gzipBytes)}, brotli ${formatBytes(entry.brotliBytes)} <= ${formatBytes(budget.maxBrotliBytes)}`,
        passed ? colors.green : colors.red,
      ))
      if (!passed) hasBudgetFailure = true
    }
  }

  if (hasBudgetFailure) process.exitCode = 1
}
