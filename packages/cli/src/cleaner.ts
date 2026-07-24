import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'

import type { CleanLevel, CleanerOptions, LevelConfig, Removal, ReinstallPolicy, WebToolkitCliConfig } from './config.js'

type CommandSpec = {
  command: string
  args: string[]
}

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/').split(path.sep).join('/')
}

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern, 'i'))
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function readDirSafe(target: string): Promise<string[]> {
  try {
    return await fs.readdir(target)
  } catch {
    return []
  }
}

function isWorkspaceRoot(relPath: string, workspaceRootNames: Set<string>): boolean {
  const normalized = toPosix(relPath)
  if (normalized === '') return true

  const parts = normalized.split('/').filter(Boolean)
  if (parts.length !== 2) return false
  return workspaceRootNames.has(parts[0]) && parts[1].length > 0
}

function isProtectedRoot(relFromRoot: string, protectedRootNames: Set<string>): boolean {
  const parts = toPosix(relFromRoot).split('/').filter(Boolean)
  return parts.length === 1 && protectedRootNames.has(parts[0])
}

function shouldRemoveFile(fileName: string, relPath: string, config: LevelConfig): boolean {
  const normalizedRelPath = toPosix(relPath)
  const patterns = compilePatterns(config.removableFilePatterns)

  if (config.removableSpecificFiles.map(toPosix).includes(normalizedRelPath)) return true
  if (config.removableFileNames.includes(fileName)) return true
  if (config.removableFileSuffixes.some((suffix) => fileName.endsWith(suffix))) return true
  if (config.removableFilePrefixes.some((prefix) => fileName.startsWith(prefix))) return true
  return patterns.some((pattern) => pattern.test(fileName))
}

async function removeTarget(targetPath: string, options: CleanerOptions): Promise<void> {
  if (options.dryRun) return
  await fs.rm(targetPath, { recursive: true, force: true })
}

async function collectArtifactRemovals(
  dirPath: string,
  options: CleanerOptions,
  levelConfig: LevelConfig,
  runtime: Runtime,
  relPath = '',
  removals: Removal[] = [],
): Promise<Removal[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const workspaceRootNames = new Set(runtime.config.cleaner.workspaceRootNames)
  const skipArtifactDirNames = new Set(runtime.config.cleaner.skipArtifactDirNames)
  const currentIsWorkspaceRoot = isWorkspaceRoot(relPath, workspaceRootNames)

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name)
    const entryRelPath = relPath ? path.join(relPath, entry.name) : entry.name

    if (entry.isDirectory()) {
      if (skipArtifactDirNames.has(entry.name)) continue

      if (currentIsWorkspaceRoot && levelConfig.removableDirNames.includes(entry.name)) {
        removals.push({ kind: 'dir', relPath: entryRelPath })
        await removeTarget(entryPath, options)
        continue
      }

      await collectArtifactRemovals(entryPath, options, levelConfig, runtime, entryRelPath, removals)
      continue
    }

    if (entry.isFile() && shouldRemoveFile(entry.name, entryRelPath, levelConfig)) {
      removals.push({ kind: 'file', relPath: entryRelPath })
      await removeTarget(entryPath, options)
    }
  }

  return removals
}

async function cleanupEmptyDirectories(
  dir: string,
  relFromRoot: string,
  options: CleanerOptions,
  runtime: Runtime,
  removals: Removal[],
): Promise<boolean> {
  const dirName = path.basename(dir)
  const skipEmptyDirNames = new Set(runtime.config.cleaner.skipEmptyDirNames)
  const protectedRootNames = new Set(runtime.config.cleaner.protectedRootNames)

  if (skipEmptyDirNames.has(dirName)) return false

  const protectedRoot = isProtectedRoot(relFromRoot, protectedRootNames)
  const entries = await readDirSafe(dir)

  if (entries.length === 0) {
    if (protectedRoot) return false
    removals.push({ kind: 'empty-dir', relPath: relFromRoot || path.basename(dir) })
    if (!options.dryRun) await fs.rmdir(dir)
    return true
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry)
    const entryRelPath = path.join(relFromRoot, entry)
    if (await isDirectory(entryPath)) {
      await cleanupEmptyDirectories(entryPath, entryRelPath, options, runtime, removals)
    }
  }

  const remaining = await readDirSafe(dir)
  if (remaining.length === 0) {
    if (protectedRoot) return false
    removals.push({ kind: 'empty-dir', relPath: relFromRoot || path.basename(dir) })
    if (!options.dryRun) await fs.rmdir(dir)
    return true
  }

  return false
}

export function parseLevel(value: string): CleanLevel | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'empty') return 'empty'
  if (normalized === 'cache') return 'cache'
  if (normalized === 'deep') return 'deep'
  if (normalized === 'nuclear') return 'nuclear'
  return null
}

function parseReinstallPolicy(value: string): ReinstallPolicy | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'ask') return 'ask'
  if (normalized === 'always') return 'always'
  if (normalized === 'never') return 'never'
  return null
}

export function printCleanHelp(): void {
  console.info('Usage: webtoolkit clean [options]')
  console.info('')
  console.info('Options:')
  console.info('  --level <empty|cache|deep|nuclear>  Set cleanup level directly.')
  console.info('  --interactive                        Force interactive level prompt.')
  console.info('  --dry-run                            Print removals without deleting.')
  console.info('  --no-store-prune                     Skip package-manager store prune in nuclear mode.')
  console.info('  --reinstall <ask|always|never>       Control dependency reinstall in nuclear mode.')
  console.info('  --help                               Show this help message.')
}

export function parseCleanArgs(argv: string[]): CleanerOptions {
  const options: CleanerOptions = {
    level: undefined,
    dryRun: false,
    noStorePrune: false,
    interactive: false,
    reinstall: 'ask',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--') {
      continue
    }

    if (arg === '--help' || arg === '-h') {
      printCleanHelp()
      process.exit(0)
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--no-store-prune') {
      options.noStorePrune = true
      continue
    }

    if (arg === '--interactive') {
      options.interactive = true
      continue
    }

    if (arg === '--level') {
      const next = argv[index + 1]
      if (!next) throw new Error('Missing value for `--level`.')
      const level = parseLevel(next)
      if (!level) throw new Error(`Invalid level: ${next}`)
      options.level = level
      index += 1
      continue
    }

    if (arg.startsWith('--level=')) {
      const level = parseLevel(arg.slice('--level='.length))
      if (!level) throw new Error(`Invalid level: ${arg}`)
      options.level = level
      continue
    }

    if (arg === '--reinstall') {
      const next = argv[index + 1]
      if (!next) throw new Error('Missing value for `--reinstall`.')
      const policy = parseReinstallPolicy(next)
      if (!policy) throw new Error(`Invalid reinstall policy: ${next}`)
      options.reinstall = policy
      index += 1
      continue
    }

    if (arg.startsWith('--reinstall=')) {
      const policy = parseReinstallPolicy(arg.slice('--reinstall='.length))
      if (!policy) throw new Error(`Invalid reinstall policy: ${arg}`)
      options.reinstall = policy
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

async function chooseLevelInteractively(): Promise<CleanLevel> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive mode requires a TTY shell.')
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    console.info('Choose cleanup level:')
    console.info('  1) empty   - Remove empty directories only')
    console.info('  2) cache   - Remove cache/temp artifacts')
    console.info('  3) deep    - Cache + build artifacts (without node_modules)')
    console.info('  4) nuclear - Deep + node_modules + package-manager store prune')
    const answer = (await rl.question('Level [1-4, default 2]: ')).trim().toLowerCase()

    if (answer === '' || answer === '2' || answer === 'cache') return 'cache'
    if (answer === '1' || answer === 'empty') return 'empty'
    if (answer === '3' || answer === 'deep') return 'deep'
    if (answer === '4' || answer === 'nuclear') return 'nuclear'

    throw new Error(`Invalid level choice: ${answer}`)
  } finally {
    rl.close()
  }
}

export function resolvePackageManagerCommand(packageManager: string, commandArgs: string[]): CommandSpec {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', packageManager, ...commandArgs],
    }
  }

  return {
    command: packageManager,
    args: commandArgs,
  }
}

function runPackageManagerCommand(runtime: Runtime, commandArgs: string[], label: string): void {
  const command = resolvePackageManagerCommand(runtime.config.packageManager, commandArgs)
  const result = spawnSync(command.command, command.args, {
    cwd: runtime.cwd,
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) {
    throw new Error(`Failed to run ${label}: ${result.error.message}`)
  }

  if (result.status && result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`)
  }
}

async function shouldReinstallDependencies(options: CleanerOptions): Promise<boolean> {
  if (options.reinstall === 'always') return true
  if (options.reinstall === 'never') return false

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.info('Skipping reinstall prompt because this shell is not interactive.')
    return false
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const answer = (await rl.question('Reinstall all dependencies now with package manager install --force? [y/N] ')).trim().toLowerCase()
    return answer === 'y' || answer === 'yes' || answer === 's' || answer === 'sim'
  } finally {
    rl.close()
  }
}

function printSummary(level: CleanLevel, options: CleanerOptions, levelConfig: LevelConfig, removals: Removal[]): void {
  const normalized = removals.map((item) => ({ ...item, relPath: toPosix(item.relPath) }))
  const dirCount = normalized.filter((item) => item.kind === 'dir').length
  const emptyDirCount = normalized.filter((item) => item.kind === 'empty-dir').length
  const fileCount = normalized.filter((item) => item.kind === 'file').length

  console.info(
    `${options.dryRun ? '[dry-run] ' : ''}${levelConfig.label}: removed ${dirCount} artifact director${
      dirCount === 1 ? 'y' : 'ies'
    }, ${emptyDirCount} empty director${emptyDirCount === 1 ? 'y' : 'ies'} and ${fileCount} file${fileCount === 1 ? '' : 's'}.`,
  )

  if (normalized.length === 0) {
    console.info('No removable targets found for this level.')
    return
  }

  for (const removal of normalized.sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    console.info(` - [${removal.kind}] ${removal.relPath}`)
  }

  if (level === 'nuclear' && !options.dryRun) {
    console.info('Nuclear cleanup completed.')
  }
}

export async function runCleaner(options: CleanerOptions, runtime: Runtime): Promise<Removal[]> {
  const interactiveShell = process.stdin.isTTY && process.stdout.isTTY
  let level = options.level

  if (!level && (options.interactive || interactiveShell)) {
    level = await chooseLevelInteractively()
  }

  if (!level) {
    level = 'cache'
  }

  const levelConfig = runtime.config.cleaner.levels[level]
  const removals: Removal[] = []

  const hasArtifactTargets =
    levelConfig.removableDirNames.length > 0 ||
    levelConfig.removableFileNames.length > 0 ||
    levelConfig.removableSpecificFiles.length > 0 ||
    levelConfig.removableFileSuffixes.length > 0 ||
    levelConfig.removableFilePrefixes.length > 0 ||
    levelConfig.removableFilePatterns.length > 0

  if (hasArtifactTargets) {
    await collectArtifactRemovals(runtime.cwd, options, levelConfig, runtime, '', removals)
  }

  if (levelConfig.removeEmptyDirs) {
    const topEntries = await readDirSafe(runtime.cwd)
    for (const entry of topEntries) {
      const target = path.join(runtime.cwd, entry)
      if (await isDirectory(target)) {
        await cleanupEmptyDirectories(target, entry, options, runtime, removals)
      }
    }
  }

  printSummary(level, options, levelConfig, removals)

  if (level !== 'nuclear' || options.dryRun) return removals

  if (options.noStorePrune) {
    console.info(`Skipped \`${runtime.config.packageManager} store prune\`.`)
  } else {
    runPackageManagerCommand(runtime, ['store', 'prune'], `${runtime.config.packageManager} store prune`)
  }

  if (await shouldReinstallDependencies(options)) {
    console.info('Reinstalling dependencies...')
    runPackageManagerCommand(runtime, ['install', '--force'], `${runtime.config.packageManager} install --force`)
    return removals
  }

  console.info('Skipped dependency reinstall.')
  return removals
}
