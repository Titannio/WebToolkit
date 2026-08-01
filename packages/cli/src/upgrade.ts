import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stdin as input, stdout as output } from 'node:process'

import * as prompts from '@clack/prompts'
import semver from 'semver'

import type { TaskStepConfig, WebToolkitCliConfig } from './config.js'
import { assertExactPnpmVersion, prepareCorepackPnpm } from './environment.js'
import { buildFreshPackageManagerCommand, buildPackageManagerCommand, CommandResult, formatCommand, runCommandBuffered, runCommandInherited } from './process.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

type TargetMode = 'minor' | 'latest'
type UpgradeType = 'major' | 'minor' | 'patch'
type WorkspaceUpdates = Record<string, Record<string, string>>
type ManifestVersionMap = Record<string, string>
type ManifestVersionsByFile = Record<string, ManifestVersionMap>

type UpgradeOptions = {
  types: UpgradeType[]
  verbose: boolean
  alignProtectedSingletons: boolean
  days: number
  dryRun: boolean
  interactive: boolean
}

type UpgradeEntry = {
  filePath: string
  packageName: string
  currentVersion: string | null
  targetVersion: string
}

type ClassifiedUpgradeEntry = Omit<UpgradeEntry, 'currentVersion'> & {
  currentVersion: string
  type: UpgradeType
}

type ReportEntry = ClassifiedUpgradeEntry & {
  releaseDate: Date | null
}

type SkippedUpgradeReason = 'cooldown' | 'not-selected' | 'protected-singleton'
type SkippedUpgradeEntry = ReportEntry & {
  reason: SkippedUpgradeReason
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
const upgradeTypes: UpgradeType[] = ['major', 'minor', 'patch']
const cooldownPresets = [0, 3, 7, 14, 30]
const upgradeBooleanFlags = new Set(['--yes', '--major', '--latest', '--no-cooldown', '--isolated', '--align-protected-singletons', '--dry-run', '--verbose'])
const skippedReasonOrder: SkippedUpgradeReason[] = ['cooldown', 'not-selected', 'protected-singleton']
const skippedReasonLabels: Record<SkippedUpgradeReason, string> = {
  cooldown: 'Cooldown',
  'not-selected': 'Not selected',
  'protected-singleton': 'Protected singleton',
}
const skippedReasonPriority: Record<SkippedUpgradeReason, number> = {
  cooldown: 0,
  'not-selected': 1,
  'protected-singleton': 2,
}

function colorize(value: string, color: string): string {
  return `${color}${value}${colors.reset}`
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right))
}

function normalizeVersionSpec(version: string): string {
  return version.replace(/^[~^]/u, '')
}

export function parsePnpmPackageManagerVersion(packageManager: unknown): string | null {
  if (typeof packageManager !== 'string' || !packageManager.startsWith('pnpm@')) return null
  const version = packageManager.slice('pnpm@'.length).trim()
  assertExactPnpmVersion(version)
  return version
}

export function getVersionMajor(versionSpec: string): number | null {
  const matched = normalizeVersionSpec(versionSpec).match(/^(\d+)/u)
  return matched ? Number.parseInt(matched[1], 10) : null
}

export function shouldIncludeOutdatedTarget(currentVersion: string, latestVersion: string, target: TargetMode): boolean {
  if (!currentVersion || !latestVersion || currentVersion === latestVersion) return false
  if (target === 'latest') return true

  const currentMajor = getVersionMajor(currentVersion)
  const latestMajor = getVersionMajor(latestVersion)
  return currentMajor !== null && latestMajor !== null && currentMajor === latestMajor
}

export function applyManifestVersionStyle(currentVersion: string | undefined, targetVersion: string): string {
  if (currentVersion?.startsWith('^')) return `^${normalizeVersionSpec(targetVersion)}`
  if (currentVersion?.startsWith('~')) return `~${normalizeVersionSpec(targetVersion)}`
  return normalizeVersionSpec(targetVersion)
}

export function unquoteYamlScalar(value: string): string {
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

export function normalizeNcuJson(raw: string): WorkspaceUpdates {
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

export function parseJsonObjectFromCommandOutput(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{')
  if (start === -1) throw new Error('No JSON object found.')

  let depth = 0
  let inString = false
  let escaping = false

  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index]

    if (escaping) {
      escaping = false
      continue
    }

    if (character === '\\') {
      escaping = inString
      continue
    }

    if (character === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) {
        return JSON.parse(raw.slice(start, index + 1)) as Record<string, unknown>
      }
    }
  }

  throw new Error('Unterminated JSON object.')
}

export function toWorkspaceManifestPath(location: string, workspaceRoot: string): string | null {
  const relativeLocation = path.relative(workspaceRoot, location)
  if (relativeLocation.startsWith('..') || path.isAbsolute(relativeLocation)) return null
  const normalizedLocation = relativeLocation.replace(/\\/gu, '/')
  return normalizedLocation ? `${normalizedLocation}/package.json` : 'package.json'
}

export function normalizePnpmOutdatedJson(raw: string, workspaceRoot: string, target: TargetMode): WorkspaceUpdates {
  const trimmed = raw.trim()
  if (!trimmed) return {}

  const parsed = JSON.parse(trimmed) as Record<string, {
    current?: unknown
    dependencyType?: unknown
    latest?: unknown
    dependentPackages?: unknown
  }>
  const updatesByFile: WorkspaceUpdates = {}

  for (const [packageName, packageInfo] of Object.entries(parsed)) {
    if (packageInfo.dependencyType === 'githubAction') continue

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

export async function readManifestVersions(filePath: string): Promise<ManifestVersionMap> {
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

function getUpgradeEntryKey(filePath: string, packageName: string): string {
  return `${filePath}::${packageName}`
}

export function subtractWorkspaceUpdates(minuend: WorkspaceUpdates, subtrahend: WorkspaceUpdates): WorkspaceUpdates {
  return sortUpdatesByFile(Object.fromEntries(
    Object.entries(minuend)
      .map(([filePath, updates]) => [
        filePath,
        Object.fromEntries(
          Object.entries(updates).filter(([packageName]) => !(packageName in (subtrahend[filePath] ?? {}))),
        ),
      ])
      .filter(([, updates]) => Object.keys(updates).length > 0),
  ) as WorkspaceUpdates)
}

export function addSkippedEntries(target: Map<string, SkippedUpgradeEntry>, entries: SkippedUpgradeEntry[]): void {
  for (const entry of entries) {
    const key = getUpgradeEntryKey(entry.filePath, entry.packageName)
    const existing = target.get(key)
    if (!existing || skippedReasonPriority[entry.reason] < skippedReasonPriority[existing.reason]) {
      target.set(key, entry)
    }
  }
}

export function getUpgradeType(currentVersion: string | null, targetVersion: string): UpgradeType | null {
  if (!currentVersion) return null

  const current = semver.parse(normalizeVersionSpec(currentVersion))
  const target = semver.parse(normalizeVersionSpec(targetVersion))
  if (!current || !target) return null

  const difference = semver.diff(current, target)
  if (difference === 'major' || difference === 'premajor') return 'major'
  if (difference === 'minor' || difference === 'preminor') return 'minor'
  if (difference === 'patch' || difference === 'prepatch' || difference === 'prerelease') return 'patch'
  return null
}

export function classifyUpgradeEntries(entries: UpgradeEntry[]): ClassifiedUpgradeEntry[] {
  return entries.flatMap((entry) => {
    const type = getUpgradeType(entry.currentVersion, entry.targetVersion)
    return type && entry.currentVersion ? [{ ...entry, currentVersion: entry.currentVersion, type }] : []
  })
}

export function readProtectedOverrides(rootDir: string, relativeFilePath: string): Record<string, string> {
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

export async function updateProtectedOverrides(rootDir: string, relativeFilePath: string, overrideUpdates: Record<string, string>): Promise<void> {
  if (Object.keys(overrideUpdates).length === 0) return

  const filePath = path.join(rootDir, relativeFilePath)
  const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/u)
  const remainingPackages = new Set(Object.keys(overrideUpdates))
  let insideOverrides = false

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
  }

  if (remainingPackages.size > 0) {
    throw new Error(`Unable to update protected override(s): ${Array.from(remainingPackages).join(', ')}`)
  }

  await writeFile(filePath, lines.join('\n'))
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
    throw new Error(`Command failed: ${formatCommand(command.command, command.args)}\n${result.output}`)
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
    throw new Error(`Command failed: ${formatCommand(command.command, command.args)}`)
  }
}

async function collectNcuUpdates(runtime: Runtime, target: TargetMode): Promise<WorkspaceUpdates> {
  const args = ['exec', 'ncu', '--jsonUpgraded', '--workspaces', '--root', '--target', target]

  const result = await runBufferedPm(runtime, args)
  return normalizeNcuJson(result.output)
}

async function collectOutdatedUpdates(runtime: Runtime, target: TargetMode): Promise<WorkspaceUpdates> {
  const result = await runBufferedPm(runtime, ['outdated', '--format', 'json', '--recursive'], false)
  if (result.code !== 0 && result.code !== 1) {
    throw new Error(`Command failed: pnpm outdated --format json --recursive\n${result.output}`)
  }

  const rawUpdates = normalizePnpmOutdatedJson(result.output, runtime.cwd, target)
  const versionsByFile = await getManifestVersionsByFile(rawUpdates, runtime.cwd)

  return sortUpdatesByFile(Object.fromEntries(
    Object.entries(rawUpdates).map(([filePath, updates]) => [
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

async function collectUpgradeCandidates(runtime: Runtime, target: TargetMode): Promise<WorkspaceUpdates> {
  const [outdatedUpdates, ncuUpdates] = await Promise.all([
    collectOutdatedUpdates(runtime, target),
    collectNcuUpdates(runtime, target),
  ])

  return mergeWorkspaceUpdates(outdatedUpdates, ncuUpdates)
}

export function deriveProtectedOverrideTargetVersion(currentOverride: string | null, normalizedTargetVersion: string): string {
  if (currentOverride?.startsWith('^')) return `^${normalizedTargetVersion}`
  if (currentOverride?.startsWith('~')) return `~${normalizedTargetVersion}`
  return normalizedTargetVersion
}

export function buildProtectedUpgradePlans(runtime: Runtime, entries: UpgradeEntry[]): ProtectedUpgradePlan[] {
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

export async function getReleaseDate(runtime: Runtime, packageName: string, version: string): Promise<Date | null> {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = await runCommandBuffered({ command, args: ['view', packageName, 'time', '--json'] }, runtime.cwd)

  if (result.code !== 0 || !result.output.trim()) {
    throw new Error(`Unable to read npm release metadata for "${packageName}".`)
  }

  try {
    const times = parseJsonObjectFromCommandOutput(result.output)
    const releaseTime = times[version]
    if (typeof releaseTime !== 'string') return null
    if (!releaseTime) return null
    const releaseDate = new Date(releaseTime)
    return Number.isNaN(releaseDate.getTime()) ? null : releaseDate
  } catch {
    throw new Error(`Invalid npm release metadata for "${packageName}".`)
  }
}

function releaseDateKey(entry: UpgradeEntry): string {
  return `${entry.packageName}@${normalizeVersionSpec(entry.targetVersion)}`
}

async function resolveReleaseDates(
  runtime: Runtime,
  entries: ClassifiedUpgradeEntry[],
  cache: Map<string, Date | null>,
  required: boolean,
): Promise<Map<string, Date | null>> {
  const unresolved = new Map<string, ClassifiedUpgradeEntry>()
  for (const entry of entries) {
    const key = releaseDateKey(entry)
    if (!cache.has(key)) unresolved.set(key, entry)
  }

  for (const [key, entry] of unresolved) {
    try {
      cache.set(key, await getReleaseDate(runtime, entry.packageName, normalizeVersionSpec(entry.targetVersion)))
    } catch (error) {
      if (required) {
        throw new Error(`Cooldown pre-check failed before manifests were changed. ${(error as Error).message} Rerun with --no-cooldown to bypass release-age checks explicitly.`)
      }
      cache.set(key, null)
      console.warn(colorize(`Release date unavailable: ${entry.packageName}.`, colors.yellow))
    }
  }

  return cache
}

function toReportEntries(entries: ClassifiedUpgradeEntry[], releaseDates: Map<string, Date | null>): ReportEntry[] {
  return entries.map((entry) => ({ ...entry, releaseDate: releaseDates.get(releaseDateKey(entry)) ?? null }))
}

function getCooldownHoldPackageNames(entries: ReportEntry[], days: number): Set<string> {
  if (days <= 0) return new Set()

  return new Set(entries.flatMap((entry) => {
    if (!entry.releaseDate) {
      console.warn(colorize(`Cooldown hold: ${entry.packageName} has unknown release age.`, colors.yellow))
      return [entry.packageName]
    }
    return (Date.now() - entry.releaseDate.getTime()) / (1000 * 60 * 60 * 24) < days ? [entry.packageName] : []
  }))
}

function formatReleaseAge(releaseDate: Date): string {
  return `${Math.max(0, Math.floor((Date.now() - releaseDate.getTime()) / (1000 * 60 * 60 * 24)))} days ago`
}

function visibleLength(value: string): number {
  return value.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/gu, '').length
}

function getWorkspaceName(filePath: string): string {
  return filePath === 'package.json' ? 'root' : path.basename(path.dirname(filePath))
}

function formatUpgradeTable(entries: ReportEntry[]): string {
  const headers = ['Package', 'Workspace', 'Change', 'Released']
  const rows = entries
    .sort((left, right) => (left.releaseDate?.getTime() ?? Number.POSITIVE_INFINITY) - (right.releaseDate?.getTime() ?? Number.POSITIVE_INFINITY)
      || `${left.packageName}\0${left.filePath}`.localeCompare(`${right.packageName}\0${right.filePath}`))
    .map((entry) => [
      entry.packageName,
      getWorkspaceName(entry.filePath),
      `${entry.currentVersion} -> ${entry.targetVersion}`,
      entry.releaseDate ? `${entry.releaseDate.toISOString().slice(0, 10)} (${formatReleaseAge(entry.releaseDate)})` : 'Unknown',
    ])
  const compactRows = rows.map((cells, index) => index > 0 && [0, 2, 3].every((cellIndex) => cells[cellIndex] === rows[index - 1][cellIndex])
    ? ['', cells[1], '', '']
    : cells)
  const widths = headers.map((header, index) => Math.max(header.length, ...compactRows.map((row) => visibleLength(row[index]))))
  const separator = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`
  const row = (cells: string[]): string => `| ${cells.map((cell, index) => `${cell}${' '.repeat(widths[index] - visibleLength(cell))}`).join(' | ')} |`

  return [separator, row(headers), separator, ...compactRows.map(row), separator].join('\n')
}

function printEntryGroups(title: string, entries: ReportEntry[]): void {
  if (entries.length === 0) return
  console.info('')
  console.info(colorize(title, colors.bright))
  for (const type of upgradeTypes) {
    const group = entries.filter((entry) => entry.type === type)
    if (group.length === 0) continue
    console.info(colorize(type[0].toUpperCase() + type.slice(1), colors.cyan))
    console.info(formatUpgradeTable(group))
  }
}

function getHighestUpgradeType(entries: Pick<ClassifiedUpgradeEntry, 'type'>[]): UpgradeType {
  return upgradeTypes[Math.min(...entries.map((entry) => upgradeTypes.indexOf(entry.type)))]!
}

function getPackageSelectionOptions(entries: ClassifiedUpgradeEntry[]): { value: string, label: string, hint: string }[] {
  const entriesByPackage = new Map<string, ClassifiedUpgradeEntry[]>()
  for (const entry of entries) {
    const packageEntries = entriesByPackage.get(entry.packageName) ?? []
    packageEntries.push(entry)
    entriesByPackage.set(entry.packageName, packageEntries)
  }

  return Array.from(entriesByPackage.entries())
    .map(([packageName, packageEntries]) => ({ packageName, packageEntries, type: getHighestUpgradeType(packageEntries) }))
    .sort((left, right) => upgradeTypes.indexOf(left.type) - upgradeTypes.indexOf(right.type) || left.packageName.localeCompare(right.packageName))
    .map(({ packageName, packageEntries, type }) => ({
      value: packageName,
      label: packageName,
      hint: `${type[0].toUpperCase() + type.slice(1)} - Workspaces: ${uniqueSorted(packageEntries.map((entry) => getWorkspaceName(entry.filePath))).join(', ')}`,
    }))
}

async function selectCooldownExceptionPackageNames(entries: ReportEntry[]): Promise<Set<string> | null> {
  const options = getPackageSelectionOptions(entries)
  const selected = await prompts.multiselect({
    message: 'Select cooldown exceptions',
    options,
    required: false,
  })
  return isCancelled(selected) ? null : new Set(selected)
}

async function selectMajorPackageNames(entries: ClassifiedUpgradeEntry[]): Promise<Set<string> | null> {
  const selected = await prompts.multiselect({
    message: 'Select major updates',
    options: getPackageSelectionOptions(entries),
    required: false,
  })
  return isCancelled(selected) ? null : new Set(selected)
}

async function applyWorkspaceUpgrades(runtime: Runtime, target: TargetMode, rejectList: string[], filterPackages: string[]): Promise<void> {
  const args = ['exec', 'ncu', '--workspaces', '--root', '--color', '-u', '--target', target]
  if (rejectList.length > 0) args.push('--reject', rejectList.join(','))
  args.push('--filter', filterPackages.join(','))
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

export function runConfiguredStep(runtime: Runtime, step: TaskStepConfig): void {
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

export function parseUpgradeTypes(value: string): UpgradeType[] {
  if (value === 'all') return [...upgradeTypes]
  const values = value.split(',').map((item) => item.trim()).filter(Boolean)
  if (values.length === 0 || new Set(values).size !== values.length || values.some((item) => !upgradeTypes.includes(item as UpgradeType))) {
    throw new Error('Invalid --types value. Use major,minor,patch or all.')
  }
  return uniqueSorted(values) as UpgradeType[]
}

export function parseCliArgs(runtime: Runtime, rawArgs: string[]): UpgradeOptions {
  const daysArgs = rawArgs.filter((arg) => arg.startsWith('--days='))
  const typesArgs = rawArgs.filter((arg) => arg.startsWith('--types='))
  const unknownArgs = rawArgs.filter((arg) => !upgradeBooleanFlags.has(arg) && !arg.startsWith('--days=') && !arg.startsWith('--types='))
  if (unknownArgs.length > 0) throw new Error(`Unknown upgrade option(s): ${unknownArgs.join(', ')}`)
  if (daysArgs.length > 1) throw new Error('Use --days only once.')
  if (typesArgs.length > 1) throw new Error('Use --types only once.')
  if (daysArgs.length > 0 && rawArgs.includes('--no-cooldown')) throw new Error('Use either --days or --no-cooldown, not both.')
  if (typesArgs.length > 0 && (rawArgs.includes('--major') || rawArgs.includes('--latest'))) {
    throw new Error('Use either --types or --major/--latest, not both.')
  }

  const verbose = rawArgs.includes('--verbose')
  const daysArg = daysArgs[0]
  const typesArg = typesArgs[0]
  const defaultDays = runtime.config.upgrade?.defaultCooldownDays ?? 7
  const daysValue = daysArg?.slice('--days='.length)
  if (typeof daysValue !== 'undefined' && (!/^\d+$/u.test(daysValue) || !Number.isSafeInteger(Number(daysValue)))) {
    throw new Error('Invalid --days value. Use a non-negative integer.')
  }
  const days = typeof daysValue === 'undefined' ? (rawArgs.includes('--no-cooldown') ? 0 : defaultDays) : Number(daysValue)

  return {
    types: typesArg ? parseUpgradeTypes(typesArg.slice('--types='.length)) : rawArgs.includes('--major') || rawArgs.includes('--latest') ? [...upgradeTypes] : ['minor', 'patch'],
    verbose,
    alignProtectedSingletons: rawArgs.includes('--isolated') || rawArgs.includes('--align-protected-singletons'),
    days,
    dryRun: rawArgs.includes('--dry-run'),
    interactive: false,
  }
}

function isCancelled(value: unknown): value is symbol {
  return prompts.isCancel(value)
}

function getScopeInitialValue(types: UpgradeType[]): 'recommended' | 'all' | 'custom' {
  if (types.length === upgradeTypes.length) return 'all'
  if (types.length === 2 && types.includes('minor') && types.includes('patch')) return 'recommended'
  return 'custom'
}

export async function resolveOptions(runtime: Runtime, rawArgs: string[]): Promise<UpgradeOptions | null> {
  const cliOptions = parseCliArgs(runtime, rawArgs)
  if (rawArgs.includes('--yes') || !input.isTTY || !output.isTTY) return cliOptions

  prompts.intro('Upgrade configuration')
  const scope = await prompts.select({
    message: 'Update scope',
    initialValue: getScopeInitialValue(cliOptions.types),
    options: [
      { value: 'recommended', label: 'Recommended', hint: 'Minor and patch updates' },
      { value: 'all', label: 'All', hint: 'Major, minor, and patch updates' },
      { value: 'custom', label: 'Custom', hint: 'Choose update types' },
    ],
  })
  if (isCancelled(scope)) return null

  const selectedTypes = scope === 'recommended' ? ['minor', 'patch'] as UpgradeType[] : scope === 'all' ? [...upgradeTypes] : await prompts.multiselect({
    message: 'Update types',
    options: upgradeTypes.map((type) => ({ value: type, label: type[0].toUpperCase() + type.slice(1) })),
    initialValues: cliOptions.types,
    required: true,
  })
  if (isCancelled(selectedTypes)) return null

  const cooldownOptions = cooldownPresets.map((days) => ({
    value: days,
    label: days === 0 ? 'Disabled' : `${days} days`,
    hint: days === 0 ? 'Apply releases immediately' : undefined,
  }))
  if (!cooldownPresets.includes(cliOptions.days)) cooldownOptions.push({ value: cliOptions.days, label: `${cliOptions.days} days`, hint: 'Configured value' })
  const days = await prompts.select({
    message: 'Release cooldown',
    options: cooldownOptions,
    initialValue: cliOptions.days,
  })
  if (isCancelled(days)) return null

  const alignProtectedSingletons = await prompts.confirm({
    message: 'Upgrade protected singletons?',
    initialValue: true,
  })
  if (isCancelled(alignProtectedSingletons)) return null

  return {
    ...cliOptions,
    types: selectedTypes,
    days,
    alignProtectedSingletons,
    interactive: true,
  }
}

export async function runUpgradeEngine(runtime: Runtime, rawArgs: string[]): Promise<void> {
  const options = await resolveOptions(runtime, rawArgs)
  if (!options) {
    prompts.cancel('Upgrade cancelled.')
    return
  }

  const protectedNames = getProtectedDependencyNames(runtime)

  console.info(colorize('Checking eligible dependency updates...', colors.cyan))
  const allCandidates = await collectUpgradeCandidates(runtime, 'latest')
  const versionsByFile = await getManifestVersionsByFile(allCandidates, runtime.cwd)
  const classifiedEntries = classifyUpgradeEntries(buildUpgradeEntries(
    allCandidates,
    (filePath, packageName) => versionsByFile[filePath]?.[packageName] ?? null,
  ))
  const selectedTypeSet = new Set(options.types)
  const protectedEntryNames = new Set(protectedNames)
  const majorEntries = classifiedEntries.filter((entry) => entry.type === 'major')
  const selectableMajorEntries = majorEntries.filter((entry) => options.alignProtectedSingletons || !protectedEntryNames.has(entry.packageName))
  let selectedMajorPackageNames: Set<string> | null = null
  if (options.interactive && selectedTypeSet.has('major') && selectableMajorEntries.length > 0) {
    printEntryGroups('Candidates: major updates requiring selection', toReportEntries(selectableMajorEntries, new Map()))
    selectedMajorPackageNames = await selectMajorPackageNames(selectableMajorEntries)
    if (!selectedMajorPackageNames) {
      prompts.cancel('Upgrade cancelled.')
      return
    }
  }
  const selectedEntries = classifiedEntries.filter((entry) => selectedTypeSet.has(entry.type)
    && (entry.type !== 'major'
      || (protectedEntryNames.has(entry.packageName) && !options.alignProtectedSingletons)
      || !selectedMajorPackageNames
      || selectedMajorPackageNames.has(entry.packageName)))
  const notSelectedEntries = classifiedEntries.filter((entry) => !selectedEntries.includes(entry))
  const protectedSkippedEntries = selectedEntries.filter((entry) => protectedEntryNames.has(entry.packageName) && !options.alignProtectedSingletons)
  const cooldownCandidateEntries = selectedEntries.filter((entry) => !protectedSkippedEntries.includes(entry))
  const releaseDates = new Map<string, Date | null>()

  if (options.days > 0) {
    console.info(colorize(`Checking release age (${options.days}-day cooldown)...`, colors.cyan))
    await resolveReleaseDates(runtime, cooldownCandidateEntries, releaseDates, true)
  }
  await resolveReleaseDates(runtime, classifiedEntries, releaseDates, false)

  const notSelectedReportEntries = toReportEntries(notSelectedEntries, releaseDates)
  const protectedSkippedReportEntries = toReportEntries(protectedSkippedEntries, releaseDates)
  const cooldownCandidateReportEntries = toReportEntries(cooldownCandidateEntries, releaseDates)
  const cooldownHoldPackageNames = getCooldownHoldPackageNames(cooldownCandidateReportEntries, options.days)
  const cooldownHoldEntries = cooldownCandidateReportEntries.filter((entry) => cooldownHoldPackageNames.has(entry.packageName))
  let cooldownRejectList = new Set(cooldownHoldPackageNames)
  let eligibleEntries = cooldownCandidateReportEntries.filter((entry) => !cooldownRejectList.has(entry.packageName))
  let regularEntries = eligibleEntries.filter((entry) => !protectedEntryNames.has(entry.packageName))
  let protectedHoldEntries = eligibleEntries.filter((entry) => protectedEntryNames.has(entry.packageName))
  let protectedUpgradedEntries: ReportEntry[] = []
  let skippedEntriesByKey = new Map<string, SkippedUpgradeEntry>()

  const refreshSkippedEntries = (): void => {
    skippedEntriesByKey = new Map<string, SkippedUpgradeEntry>()
    addSkippedEntries(skippedEntriesByKey, cooldownCandidateReportEntries.filter((entry) => cooldownRejectList.has(entry.packageName)).map((entry) => ({ ...entry, reason: 'cooldown' })))
    addSkippedEntries(skippedEntriesByKey, notSelectedReportEntries.map((entry) => ({ ...entry, reason: 'not-selected' })))
    addSkippedEntries(skippedEntriesByKey, protectedSkippedReportEntries.map((entry) => ({ ...entry, reason: 'protected-singleton' })))
  }
  refreshSkippedEntries()

  printEntryGroups('Preview: eligible updates', regularEntries)
  if (options.alignProtectedSingletons) printEntryGroups('Preview: protected singleton updates', protectedHoldEntries)
  const previewSkippedEntries = Array.from(skippedEntriesByKey.values())
  for (const reason of skippedReasonOrder) {
    printEntryGroups(`Preview: ${skippedReasonLabels[reason]}`, previewSkippedEntries.filter((entry) => entry.reason === reason))
  }

  if (options.interactive && cooldownHoldEntries.length > 0) {
    const selectedCooldownExceptionPackageNames = await selectCooldownExceptionPackageNames(cooldownHoldEntries)
    if (!selectedCooldownExceptionPackageNames) {
      prompts.cancel('Upgrade cancelled.')
      return
    }

    cooldownRejectList = new Set(Array.from(cooldownHoldPackageNames).filter((packageName) => !selectedCooldownExceptionPackageNames.has(packageName)))
    eligibleEntries = cooldownCandidateReportEntries.filter((entry) => !cooldownRejectList.has(entry.packageName))
    regularEntries = eligibleEntries.filter((entry) => !protectedEntryNames.has(entry.packageName))
    protectedHoldEntries = eligibleEntries.filter((entry) => protectedEntryNames.has(entry.packageName))
    refreshSkippedEntries()

    printEntryGroups('Final review: updates to apply', regularEntries)
    if (options.alignProtectedSingletons) printEntryGroups('Final review: protected singleton upgrades', protectedHoldEntries)
    const finalSkippedEntries = Array.from(skippedEntriesByKey.values())
    for (const reason of skippedReasonOrder) {
      printEntryGroups(`Final review: ${skippedReasonLabels[reason]}`, finalSkippedEntries.filter((entry) => entry.reason === reason))
    }
  }

  const protectedPlans = options.alignProtectedSingletons && protectedHoldEntries.length > 0
    ? buildProtectedUpgradePlans(runtime, protectedHoldEntries)
    : []

  if (options.dryRun) {
    if (regularEntries.length === 0 && protectedHoldEntries.length === 0) {
      console.info('- No eligible dependency updates.')
    }
    prompts.outro('Dry run complete. No files changed.')
    return
  }

  if (options.interactive && (regularEntries.length > 0 || protectedHoldEntries.length > 0)) {
    const confirmed = await prompts.confirm({ message: 'Apply these upgrades?', initialValue: true })
    if (isCancelled(confirmed) || !confirmed) {
      prompts.cancel('Upgrade cancelled.')
      return
    }
  }

  if (regularEntries.length > 0) {
    console.info(colorize('Applying dependency updates...', colors.cyan))
    const previousPnpmVersion = await readRootPnpmPackageManagerVersion(runtime.cwd)
    await applyWorkspaceUpgrades(runtime, 'latest', mergeRejectLists(Array.from(cooldownRejectList), protectedNames), uniqueSorted(eligibleEntries.map((entry) => entry.packageName)))
    const useFreshPackageManager = await preparePackageManagerAfterManifestUpdates(runtime, previousPnpmVersion)
    console.info(colorize('Installing dependencies...', colors.cyan))
    await installDependencies(runtime, useFreshPackageManager)
  }

  if (options.alignProtectedSingletons && protectedHoldEntries.length > 0) {
    const selectedPackages = protectedPlans.map((plan) => plan.packageName)
    const overrideUpdates = Object.fromEntries(protectedPlans.map((plan) => [plan.packageName, plan.targetVersion]))

    console.info(colorize('Applying protected singleton upgrades...', colors.cyan))
    const previousPnpmVersion = await readRootPnpmPackageManagerVersion(runtime.cwd)
    await applyWorkspaceUpgrades(runtime, 'latest', Array.from(cooldownRejectList), selectedPackages)
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

  addSkippedEntries(skippedEntriesByKey, protectedHoldEntries.map((entry) => ({
    ...entry,
    reason: 'protected-singleton',
  })))

  console.info('')
  console.info(colorize('Upgrade complete', `${colors.bright}${colors.green}`))
  if (regularEntries.length === 0 && protectedUpgradedEntries.length === 0) {
    console.info('')
    console.info('- No eligible dependency updates.')
  }
  printEntryGroups('Updated', regularEntries)
  printEntryGroups('Protected singleton upgrades', protectedUpgradedEntries)

  const skippedEntries = Array.from(skippedEntriesByKey.values())
  if (skippedEntries.length > 0) {
    const hints = runtime.config.upgrade?.protectedDependencyUpstreamHints ?? {}
    console.info('')
    console.info(colorize('Not updated', colors.bright))

    for (const reason of skippedReasonOrder) {
      const reasonEntries = skippedEntries.filter((entry) => entry.reason === reason)
      if (reasonEntries.length === 0) continue

      printEntryGroups(`Not updated: ${skippedReasonLabels[reason]}`, reasonEntries)

      if (reason !== 'protected-singleton') continue

      for (const packageName of uniqueSorted(reasonEntries.map((entry) => entry.packageName))) {
        const upstreamPackages = hints[packageName] ?? []
        if (upstreamPackages.length > 0) {
          console.info(`  ${colorize(packageName, colors.cyan)}: review/update ${colorize(upstreamPackages.join(', '), colors.bright)} before upgrading.`)
        }
      }
    }
  }

  if (options.verbose) {
    console.info(colorize(`Executed with types=${options.types.join(',')}.`, colors.gray))
  }
}
