import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

import type { WebToolkitCliConfig } from './config.js'

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
  if (allAssets.length === 0) {
    console.info(colorize('No JS/CSS bundle assets found. Run the frontend builds before auditing.', colors.yellow))
    process.exitCode = 1
    return
  }

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
