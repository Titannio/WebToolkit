import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import type { TaskStepConfig, WebToolkitCliConfig } from './config.js'
import { prepareCorepackPnpm } from './environment.js'
import { buildFreshPackageManagerCommand, buildPackageManagerCommand, CommandResult, formatCommand, runCommandBuffered, runCommandInherited } from './process.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

type TargetMode = 'minor' | 'latest'
type WorkspaceUpdates = Record<string, Record<string, string>>
type ManifestVersionMap = Record<string, string>
type ManifestVersionsByFile = Record<string, ManifestVersionMap>

type UpgradeOptions = {
  allowMajor: boolean
  verbose: boolean
  alignProtectedSingletons: boolean
  days: number
}

type UpgradeEntry = {
  filePath: string
  packageName: string
  currentVersion: string | null
  targetVersion: string
}

type ProtectedUpgradePlan = {
  packageName: string
  currentOverride: string | null
  targetVersion: string
  upstreamHints: string[]
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

const manifestVersionFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

function colorize(value: string, color: string): string {
  return `${color}${value}${colors.reset}`
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right))
}

function normalizeVersionSpec(version: string): string {
  return version.replace(/^[~^]/u, '')
}

function validatePinnedPnpmVersion(version: string): void {
  if (!version || version.includes(' ') || version === 'latest' || version === '11') {
    throw new Error(`packageManager must pin an exact pnpm version, but found ${JSON.stringify(`pnpm@${version}`)}.`)
  }
}

function parsePnpmPackageManagerVersion(packageManager: unknown): string | null {
  if (typeof packageManager !== 'string' || !packageManager.startsWith('pnpm@')) return null
  const version = packageManager.slice('pnpm@'.length).trim()
  validatePinnedPnpmVersion(version)
  return version
}

function getVersionMajor(versionSpec: string): number | null {
  const matched = normalizeVersionSpec(versionSpec).match(/^(\d+)/u)
  return matched ? Number.parseInt(matched[1], 10) : null
}

function shouldIncludeOutdatedTarget(currentVersion: string, latestVersion: string, target: TargetMode): boolean {
  if (!currentVersion || !latestVersion || currentVersion === latestVersion) return false
  if (target === 'latest') return true

  const currentMajor = getVersionMajor(currentVersion)
  const latestMajor = getVersionMajor(latestVersion)
  return currentMajor !== null && latestMajor !== null && currentMajor === latestMajor
}

function applyManifestVersionStyle(currentVersion: string | undefined, targetVersion: string): string {
  if (currentVersion?.startsWith('^')) return `^${normalizeVersionSpec(targetVersion)}`
  if (currentVersion?.startsWith('~')) return `~${normalizeVersionSpec(targetVersion)}`
  return normalizeVersionSpec(targetVersion)
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function sortUpdatesByFile(updatesByFile: WorkspaceUpdates): WorkspaceUpdates {
  return Object.fromEntries(
    Object.entries(updatesByFile)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, updates]) => [
        filePath,
        Object.fromEntries(Object.entries(updates).sort(([left], [right]) => left.localeCompare(right))),
      ]),
  )
}

function mergeWorkspaceUpdates(...sources: WorkspaceUpdates[]): WorkspaceUpdates {
  const merged: WorkspaceUpdates = {}
  for (const source of sources) {
    for (const [filePath, updates] of Object.entries(source)) {
      merged[filePath] = { ...(merged[filePath] ?? {}), ...updates }
    }
  }
  return sortUpdatesByFile(merged)
}

function normalizeNcuJson(raw: string): WorkspaceUpdates {
  const trimmed = raw.trim()
  if (!trimmed) return {}

  const parsed = JSON.parse(trimmed) as Record<string, unknown>
  const entries = Object.entries(parsed)
  const looksLikeWorkspaceMap = entries.every(([, value]) => value !== null && typeof value === 'object' && !Array.isArray(value))

  if (!looksLikeWorkspaceMap) {
    return {
      'package.json': Object.fromEntries(entries.filter(([, value]) => typeof value === 'string')) as Record<string, string>,
    }
  }

  return sortUpdatesByFile(Object.fromEntries(
    entries.map(([filePath, value]) => [
      filePath,
      Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, version]) => typeof version === 'string')),
    ]),
  ) as WorkspaceUpdates)
}

function toWorkspaceManifestPath(location: string, workspaceRoot: string): string | null {
  const relativeLocation = path.relative(workspaceRoot, location)
  if (relativeLocation.startsWith('..') || path.isAbsolute(relativeLocation)) return null
  const normalizedLocation = relativeLocation.replace(/\\/gu, '/')
  return normalizedLocation ? `${normalizedLocation}/package.json` : 'package.json'
}

function normalizePnpmOutdatedJson(raw: string, workspaceRoot: string, target: TargetMode): WorkspaceUpdates {
  const trimmed = raw.trim()
  if (!trimmed) return {}

  const parsed = JSON.parse(trimmed) as Record<string, {
    current?: unknown
    latest?: unknown
    dependentPackages?: unknown
  }>
  const updatesByFile: WorkspaceUpdates = {}

  for (const [packageName, packageInfo] of Object.entries(parsed)) {
    const currentVersion = typeof packageInfo.current === 'string' ? packageInfo.current : null
    const latestVersion = typeof packageInfo.latest === 'string' ? packageInfo.latest : null
    if (!currentVersion || !latestVersion || !shouldIncludeOutdatedTarget(currentVersion, latestVersion, target)) continue

    const dependentPackages = Array.isArray(packageInfo.dependentPackages) ? packageInfo.dependentPackages : []
    for (const dependentPackage of dependentPackages) {
      const location = typeof dependentPackage === 'object' && dependentPackage !== null && 'location' in dependentPackage
        ? dependentPackage.location
        : null
      if (typeof location !== 'string') continue
      const manifestPath = toWorkspaceManifestPath(location, workspaceRoot)
      if (!manifestPath) continue
      updatesByFile[manifestPath] = {
        ...(updatesByFile[manifestPath] ?? {}),
        [packageName]: latestVersion,
      }
    }
  }

  return sortUpdatesByFile(updatesByFile)
}

async function readManifestVersions(filePath: string): Promise<ManifestVersionMap> {
  const manifest = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
  const versions: ManifestVersionMap = {}

  for (const field of manifestVersionFields) {
    const section = manifest[field]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue
    for (const [packageName, version] of Object.entries(section)) {
      if (typeof version === 'string') versions[packageName] = version
    }
  }

  return versions
}

async function readRootPnpmPackageManagerVersion(rootDir: string): Promise<string | null> {
  const manifest = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8')) as Record<string, unknown>
  return parsePnpmPackageManagerVersion(manifest.packageManager)
}

async function getManifestVersionsByFile(updatesByFile: WorkspaceUpdates, rootDir: string): Promise<ManifestVersionsByFile> {
  const files = Object.keys(updatesByFile)
  const entries = await Promise.all(
    files.map(async (filePath) => [filePath, await readManifestVersions(path.join(rootDir, filePath))] as const),
  )

  return Object.fromEntries(entries)
}

function buildUpgradeEntries(
  updatesByFile: WorkspaceUpdates,
  resolveCurrentVersion: (filePath: string, packageName: string, targetVersion: string) => string | null,
): UpgradeEntry[] {
  const entries: UpgradeEntry[] = []

  for (const [filePath, updates] of Object.entries(sortUpdatesByFile(updatesByFile))) {
    for (const [packageName, targetVersion] of Object.entries(updates)) {
      entries.push({
        filePath,
        packageName,
        currentVersion: resolveCurrentVersion(filePath, packageName, targetVersion),
        targetVersion,
      })
    }
  }

  return entries
}

function readProtectedOverrides(rootDir: string, relativeFilePath: string): Record<string, string> {
  const filePath = path.join(rootDir, relativeFilePath)
  if (!existsSync(filePath)) return {}

  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u)
  const overrides: Record<string, string> = {}
  let insideOverrides = false

  for (const line of lines) {
    if (!insideOverrides) {
      if (/^overrides:\s*$/u.test(line)) insideOverrides = true
      continue
    }

    if (/^\S/u.test(line)) break
    const match = line.match(/^(\s{2,})([^:#][^:]*):\s*(.*?)\s*$/u)
    if (!match) continue

    overrides[unquoteYamlScalar(match[2])] = unquoteYamlScalar(match[3])
  }

  return overrides
}

async function updateProtectedOverrides(rootDir: string, relativeFilePath: string, overrideUpdates: Record<string, string>): Promise<void> {
  if (Object.keys(overrideUpdates).length === 0) return

  const filePath = path.join(rootDir, relativeFilePath)
  const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/u)
  const remainingPackages = new Set(Object.keys(overrideUpdates))
  let insideOverrides = false
  let modified = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (!insideOverrides) {
      if (/^overrides:\s*$/u.test(line)) insideOverrides = true
      continue
    }

    if (/^\S/u.test(line)) break
    const match = line.match(/^(\s{2,})([^:#][^:]*):\s*(.*?)\s*$/u)
    if (!match) continue

    const packageName = unquoteYamlScalar(match[2])
    const targetVersion = overrideUpdates[packageName]
    if (!targetVersion) continue

    lines[index] = `${match[1]}${match[2]}: ${targetVersion}`
    remainingPackages.delete(packageName)
    modified = true
  }

  if (remainingPackages.size > 0) {
    throw new Error(`Unable to update protected override(s): ${Array.from(remainingPackages).join(', ')}`)
  }

  if (modified) await writeFile(filePath, lines.join('\n'))
}

function getProtectedDependencyNames(runtime: Runtime): string[] {
  return Object.keys(readProtectedOverrides(runtime.cwd, runtime.config.upgrade?.protectedOverridesFile ?? 'pnpm-workspace.yaml')).sort((left, right) => left.localeCompare(right))
}

export function mergeRejectLists(baseRejectList: string[], protectedDependencyNames: string[]): string[] {
  return uniqueSorted([...baseRejectList, ...protectedDependencyNames])
}

async function runBufferedPm(runtime: Runtime, args: string[], rejectOnNonZero = true): Promise<CommandResult> {
  const command = buildPackageManagerCommand(runtime.config.packageManager, args)
  const result = await runCommandBuffered(command, runtime.cwd)
  if (rejectOnNonZero && result.code !== 0) {
    throw new Error(`Command failed: ${formatCommand(command.command, command.args ?? [])}\n${result.output}`)
  }
  return result
}

function runInheritedPm(
  runtime: Runtime,
  args: string[],
  buildCommand: (packageManager: string, args: string[]) => ReturnType<typeof buildPackageManagerCommand> = buildPackageManagerCommand,
): void {
  const command = buildCommand(runtime.config.packageManager, args)
  const code = runCommandInherited(command, runtime.cwd)
  if (code !== 0) {
    throw new Error(`Command failed: ${formatCommand(command.command, command.args ?? [])}`)
  }
}

async function collectNcuUpdates(runtime: Runtime, target: TargetMode, rejectList: string[], includeProtected: boolean): Promise<WorkspaceUpdates> {
  const protectedNames = getProtectedDependencyNames(runtime)
  const mergedRejectList = includeProtected ? rejectList : mergeRejectLists(rejectList, protectedNames)
  const args = ['exec', 'ncu', '--jsonUpgraded', '--workspaces', '--root', '--target', target]
  if (mergedRejectList.length > 0) args.push('--reject', mergedRejectList.join(','))

  const result = await runBufferedPm(runtime, args)
  return normalizeNcuJson(result.output)
}

async function collectOutdatedUpdates(runtime: Runtime, target: TargetMode, rejectList: string[], includeProtected: boolean): Promise<WorkspaceUpdates> {
  const protectedNames = getProtectedDependencyNames(runtime)
  const mergedRejectList = new Set(includeProtected ? rejectList : mergeRejectLists(rejectList, protectedNames))
  const result = await runBufferedPm(runtime, ['outdated', '--format', 'json', '--recursive'], false)
  if (result.code !== 0 && result.code !== 1) {
    throw new Error(`Command failed: pnpm outdated --format json --recursive\n${result.output}`)
  }

  const rawUpdates = normalizePnpmOutdatedJson(result.output, runtime.cwd, target)
  const filteredUpdates = Object.fromEntries(
    Object.entries(rawUpdates)
      .map(([filePath, updates]) => [
        filePath,
        Object.fromEntries(Object.entries(updates).filter(([packageName]) => !mergedRejectList.has(packageName))),
      ])
      .filter(([, updates]) => Object.keys(updates).length > 0),
  ) as WorkspaceUpdates
  const versionsByFile = await getManifestVersionsByFile(filteredUpdates, runtime.cwd)

  return sortUpdatesByFile(Object.fromEntries(
    Object.entries(filteredUpdates).map(([filePath, updates]) => [
      filePath,
      Object.fromEntries(
        Object.entries(updates).map(([packageName, targetVersion]) => [
          packageName,
          applyManifestVersionStyle(versionsByFile[filePath]?.[packageName], targetVersion),
        ]),
      ),
    ]),
  ) as WorkspaceUpdates)
}

async function collectUpgradeCandidates(runtime: Runtime, target: TargetMode, rejectList: string[], includeProtected = false): Promise<WorkspaceUpdates> {
  const [outdatedUpdates, ncuUpdates] = await Promise.all([
    collectOutdatedUpdates(runtime, target, rejectList, includeProtected),
    collectNcuUpdates(runtime, target, rejectList, includeProtected),
  ])

  return mergeWorkspaceUpdates(outdatedUpdates, ncuUpdates)
}

async function collectProtectedHoldUpdates(runtime: Runtime, target: TargetMode, rejectList: string[] = []): Promise<WorkspaceUpdates> {
  const protectedNames = new Set(getProtectedDependencyNames(runtime))
  const allCandidates = await collectUpgradeCandidates(runtime, target, rejectList, true)

  return sortUpdatesByFile(Object.fromEntries(
    Object.entries(allCandidates)
      .map(([filePath, updates]) => [
        filePath,
        Object.fromEntries(Object.entries(updates).filter(([packageName]) => protectedNames.has(packageName))),
      ])
      .filter(([, updates]) => Object.keys(updates).length > 0),
  ) as WorkspaceUpdates)
}

function deriveProtectedOverrideTargetVersion(currentOverride: string | null, normalizedTargetVersion: string): string {
  if (currentOverride?.startsWith('^')) return `^${normalizedTargetVersion}`
  if (currentOverride?.startsWith('~')) return `~${normalizedTargetVersion}`
  return normalizedTargetVersion
}

function buildProtectedUpgradePlans(runtime: Runtime, entries: UpgradeEntry[]): ProtectedUpgradePlan[] {
  const currentOverrides = readProtectedOverrides(runtime.cwd, runtime.config.upgrade?.protectedOverridesFile ?? 'pnpm-workspace.yaml')
  const hints = runtime.config.upgrade?.protectedDependencyUpstreamHints ?? {}
  const normalizedTargetsByPackage = new Map<string, Set<string>>()

  for (const entry of entries) {
    const normalizedTargets = normalizedTargetsByPackage.get(entry.packageName) ?? new Set<string>()
    normalizedTargets.add(normalizeVersionSpec(entry.targetVersion))
    normalizedTargetsByPackage.set(entry.packageName, normalizedTargets)
  }

  return Array.from(normalizedTargetsByPackage.entries())
    .map(([packageName, targets]) => {
      if (targets.size !== 1) {
        throw new Error(`Protected singleton upgrade target is ambiguous for "${packageName}".`)
      }
      const [targetVersion] = Array.from(targets)
      const currentOverride = currentOverrides[packageName] ?? null
      return {
        packageName,
        currentOverride,
        targetVersion: deriveProtectedOverrideTargetVersion(currentOverride, targetVersion),
        upstreamHints: hints[packageName] ?? [],
      }
    })
    .sort((left, right) => left.packageName.localeCompare(right.packageName))
}

async function getReleaseDate(runtime: Runtime, packageName: string, version: string): Promise<Date | null> {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = await runCommandBuffered({ command, args: ['view', packageName, 'time', '--json'] }, runtime.cwd)

  if (result.code !== 0 || !result.output.trim()) {
    throw new Error(`Unable to read npm release metadata for "${packageName}".`)
  }

  try {
    const times = JSON.parse(result.output) as Record<string, string>
    const releaseTime = times[version]
    if (!releaseTime) return null
    const releaseDate = new Date(releaseTime)
    return Number.isNaN(releaseDate.getTime()) ? null : releaseDate
  } catch {
    throw new Error(`Invalid npm release metadata for "${packageName}".`)
  }
}

async function getCooldownRejectList(runtime: Runtime, days: number, target: TargetMode): Promise<string[]> {
  if (days <= 0) return []

  try {
    console.info(colorize(`Checking release age for ${target} updates (${days}-day cooldown)...`, colors.cyan))
    const candidatesByFile = await collectUpgradeCandidates(runtime, target, [], true)
    const allCandidates = new Map<string, string>()

    for (const fileUpdates of Object.values(candidatesByFile)) {
      for (const [packageName, targetVersion] of Object.entries(fileUpdates)) {
        allCandidates.set(packageName, targetVersion)
      }
    }

    const rejectList: string[] = []
    let processed = 0
    const candidates = Array.from(allCandidates.entries())

    for (const [packageName, targetVersion] of candidates) {
      const releaseDate = await getReleaseDate(runtime, packageName, normalizeVersionSpec(targetVersion))
      processed += 1
      process.stdout.write(`\rCooldown ${processed}/${candidates.length}`)
      if (!releaseDate) {
        rejectList.push(packageName)
        console.warn(colorize(`\nCooldown hold: ${packageName} has unknown release age.`, colors.yellow))
        continue
      }

      const ageInDays = (Date.now() - releaseDate.getTime()) / (1000 * 60 * 60 * 24)
      if (ageInDays < days) rejectList.push(packageName)
    }

    if (candidates.length > 0) console.info('')
    return rejectList.sort((left, right) => left.localeCompare(right))
  } catch (error) {
    throw new Error(`Cooldown pre-check failed before manifests were changed. ${(error as Error).message} Rerun with --no-cooldown to bypass release-age checks explicitly.`)
  }
}

function formatEntryGroups(entries: UpgradeEntry[]): string[] {
  const byFile = new Map<string, UpgradeEntry[]>()
  for (const entry of entries) {
    const list = byFile.get(entry.filePath) ?? []
    list.push(entry)
    byFile.set(entry.filePath, list)
  }

  return Array.from(byFile.entries()).flatMap(([filePath, fileEntries]) => [
    colorize(filePath, colors.cyan),
    ...fileEntries.map((entry) => `  ${entry.packageName}: ${entry.currentVersion ?? '?'} -> ${entry.targetVersion}`),
  ])
}

async function applyWorkspaceUpgrades(runtime: Runtime, target: TargetMode, rejectList: string[] = [], filterPackages: string[] = []): Promise<void> {
  const args = ['exec', 'ncu', '--workspaces', '--root', '--color', '-u', '--target', target]
  if (rejectList.length > 0) args.push('--reject', rejectList.join(','))
  if (filterPackages.length > 0) args.push('--filter', filterPackages.join(','))
  runInheritedPm(runtime, args)
}

async function installDependencies(runtime: Runtime, useFreshPackageManager: boolean): Promise<void> {
  try {
    runInheritedPm(runtime, ['install'], useFreshPackageManager ? buildFreshPackageManagerCommand : buildPackageManagerCommand)
  } catch (error) {
    throw new Error([
      'Dependency install failed after manifest updates.',
      'The package.json files may already be changed while the lockfile/install is incomplete.',
      `Run ${formatCommand(runtime.config.packageManager, ['install'])} after fixing the package-manager environment.`,
      (error as Error).message,
    ].join('\n'))
  }
}

async function preparePackageManagerAfterManifestUpdates(runtime: Runtime, previousPnpmVersion: string | null): Promise<boolean> {
  const currentPnpmVersion = await readRootPnpmPackageManagerVersion(runtime.cwd)
  if (!currentPnpmVersion || currentPnpmVersion === previousPnpmVersion) return false

  console.info(colorize(`Preparing pnpm ${currentPnpmVersion} via Corepack...`, colors.cyan))
  prepareCorepackPnpm(runtime, runtime.cwd, currentPnpmVersion)
  return true
}

function runConfiguredStep(runtime: Runtime, step: TaskStepConfig): void {
  if (!step.command) {
    throw new Error(`Configured upgrade step "${step.label}" must define command.`)
  }

  console.info(colorize(step.label, colors.cyan))
  const code = runCommandInherited({
    command: step.command,
    args: step.args ?? [],
    cwd: step.cwd,
    env: step.env,
  }, runtime.cwd)
  if (code !== 0) process.exit(code)
}

function parseCliArgs(runtime: Runtime, rawArgs: string[]): UpgradeOptions {
  const verbose = rawArgs.includes('--verbose')
  const daysArg = rawArgs.find((arg) => arg.startsWith('--days='))
  const defaultDays = runtime.config.upgrade?.defaultCooldownDays ?? 7
  const days = daysArg
    ? Number.parseInt(daysArg.slice('--days='.length), 10)
    : rawArgs.includes('--no-cooldown') ? 0 : defaultDays

  return {
    allowMajor: rawArgs.includes('--major') || rawArgs.includes('--latest'),
    verbose,
    alignProtectedSingletons: rawArgs.includes('--isolated') || rawArgs.includes('--align-protected-singletons'),
    days: Number.isFinite(days) && days > 0 ? days : 0,
  }
}

export function parseYesNo(answer: string, defaultValue: boolean): boolean | null {
  const normalized = answer.trim().toLowerCase()
  if (!normalized) return defaultValue
  if (['s', 'sim', 'y', 'yes'].includes(normalized)) return true
  if (['n', 'nao', 'não', 'no'].includes(normalized)) return false
  return null
}

export function formatYesNoPrompt(icon: string, question: string, defaultValue: boolean): string {
  return `${icon} ${question} [Y/N] ${defaultValue ? 'Y' : 'N'} `
}

async function promptYesNo(prompt: ReturnType<typeof createInterface>, question: string, defaultValue: boolean): Promise<boolean> {
  while (true) {
    const parsed = parseYesNo(await prompt.question(question), defaultValue)
    if (parsed !== null) return parsed
    console.info(colorize('Invalid answer. Use Y or N.', colors.yellow))
  }
}

async function resolveOptions(runtime: Runtime, rawArgs: string[]): Promise<UpgradeOptions> {
  const cliOptions = parseCliArgs(runtime, rawArgs)
  if (rawArgs.includes('--yes') || !input.isTTY || !output.isTTY) return cliOptions

  console.info(colorize('Upgrade configuration', colors.bright))
  const prompt = createInterface({ input, output })
  try {
    const cooldownEnabled = await promptYesNo(prompt, formatYesNoPrompt('❄', 'Cooldown enabled?', cliOptions.days > 0), cliOptions.days > 0)
    const allowMajor = await promptYesNo(prompt, formatYesNoPrompt('↗', 'Major upgrades?', cliOptions.allowMajor), cliOptions.allowMajor)
    const alignProtectedSingletons = await promptYesNo(prompt, formatYesNoPrompt('🔄', 'Protected singleton upgrades?', cliOptions.alignProtectedSingletons), cliOptions.alignProtectedSingletons)
    return {
      allowMajor,
      verbose: cliOptions.verbose,
      alignProtectedSingletons,
      days: cooldownEnabled ? (cliOptions.days > 0 ? cliOptions.days : (runtime.config.upgrade?.defaultCooldownDays ?? 7)) : 0,
    }
  } finally {
    prompt.close()
  }
}

export async function runUpgradeEngine(runtime: Runtime, rawArgs: string[]): Promise<void> {
  const options = await resolveOptions(runtime, rawArgs)
  const target: TargetMode = options.allowMajor ? 'latest' : 'minor'
  const protectedNames = getProtectedDependencyNames(runtime)

  console.info(colorize('Checking eligible dependency updates...', colors.cyan))
  const cooldownRejectList = await getCooldownRejectList(runtime, options.days, target)
  const upgradeCandidates = await collectUpgradeCandidates(runtime, target, cooldownRejectList)
  const versionsByFile = await getManifestVersionsByFile(upgradeCandidates, runtime.cwd)
  const updatedEntries = buildUpgradeEntries(upgradeCandidates, (filePath, packageName) => versionsByFile[filePath]?.[packageName] ?? null)
  const protectedHoldUpdates = await collectProtectedHoldUpdates(runtime, target, cooldownRejectList)
  const protectedHoldVersionsByFile = await getManifestVersionsByFile(protectedHoldUpdates, runtime.cwd)
  let protectedHoldEntries = buildUpgradeEntries(protectedHoldUpdates, (filePath, packageName) => protectedHoldVersionsByFile[filePath]?.[packageName] ?? null)
  let protectedUpgradedEntries: UpgradeEntry[] = []

  if (updatedEntries.length > 0) {
    console.info(colorize('Applying dependency updates...', colors.cyan))
    const previousPnpmVersion = await readRootPnpmPackageManagerVersion(runtime.cwd)
    await applyWorkspaceUpgrades(runtime, target, mergeRejectLists(cooldownRejectList, protectedNames))
    const useFreshPackageManager = await preparePackageManagerAfterManifestUpdates(runtime, previousPnpmVersion)
    console.info(colorize('Installing dependencies...', colors.cyan))
    await installDependencies(runtime, useFreshPackageManager)
  }

  if (options.alignProtectedSingletons && protectedHoldEntries.length > 0) {
    const plans = buildProtectedUpgradePlans(runtime, protectedHoldEntries)
    const selectedPackages = plans.map((plan) => plan.packageName)
    const overrideUpdates = Object.fromEntries(plans.map((plan) => [plan.packageName, plan.targetVersion]))

    console.info(colorize('Applying protected singleton upgrades...', colors.cyan))
    const previousPnpmVersion = await readRootPnpmPackageManagerVersion(runtime.cwd)
    await applyWorkspaceUpgrades(runtime, target, cooldownRejectList, selectedPackages)
    console.info(colorize('Updating protected dependency overrides...', colors.cyan))
    await updateProtectedOverrides(runtime.cwd, runtime.config.upgrade?.protectedOverridesFile ?? 'pnpm-workspace.yaml', overrideUpdates)
    const useFreshPackageManager = await preparePackageManagerAfterManifestUpdates(runtime, previousPnpmVersion)
    console.info(colorize('Installing dependencies after protected singleton upgrades...', colors.cyan))
    await installDependencies(runtime, useFreshPackageManager)

    if (runtime.config.upgrade?.singletonGuardCommand) {
      runConfiguredStep(runtime, runtime.config.upgrade.singletonGuardCommand)
    }

    const selected = new Set(selectedPackages)
    protectedUpgradedEntries = protectedHoldEntries.filter((entry) => selected.has(entry.packageName))
    protectedHoldEntries = protectedHoldEntries.filter((entry) => !selected.has(entry.packageName))
  }

  console.info('')
  console.info(colorize('Upgrade complete', `${colors.bright}${colors.green}`))
  console.info('')
  console.info(colorize('Updated', colors.bright))
  if (updatedEntries.length === 0) {
    console.info('- No eligible dependency updates.')
  } else {
    for (const line of formatEntryGroups(updatedEntries)) console.info(`- ${line}`)
  }

  if (options.days > 0) {
    console.info('')
    console.info(colorize('Cooldown holds', colors.bright))
    console.info(`- ${cooldownRejectList.length} package(s) skipped by ${options.days}-day cooldown.`)
  }

  if (protectedUpgradedEntries.length > 0) {
    console.info('')
    console.info(colorize('Protected singleton upgrades', colors.bright))
    for (const line of formatEntryGroups(protectedUpgradedEntries)) console.info(`- ${line}`)
  }

  if (protectedHoldEntries.length > 0) {
    const hints = runtime.config.upgrade?.protectedDependencyUpstreamHints ?? {}
    console.info('')
    console.info(colorize('Protected singleton holds', colors.bright))
    for (const line of formatEntryGroups(protectedHoldEntries)) console.info(`- ${line}`)

    for (const packageName of uniqueSorted(protectedHoldEntries.map((entry) => entry.packageName))) {
      const upstreamPackages = hints[packageName] ?? []
      if (upstreamPackages.length > 0) {
        console.info(`- ${colorize(packageName, colors.cyan)}: review/update ${colorize(upstreamPackages.join(', '), colors.bright)} before upgrading.`)
      }
    }
  }

  if (options.verbose) {
    console.info(colorize(`Executed with target=${target}.`, colors.gray))
  }
}
