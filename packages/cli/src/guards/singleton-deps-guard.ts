#!/usr/bin/env tsx
// @ts-nocheck

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readPnpmWorkspaceOverrides } from './pnpm-workspace-config.js'

const require = createRequire(import.meta.url)
const semver = require('semver') as typeof import('semver')

const ROOT_DIR = process.cwd()
const ROOT_PACKAGE_JSON_PATH = path.resolve(ROOT_DIR, 'package.json')
const LOCKFILE_PATH = path.resolve(ROOT_DIR, 'pnpm-lock.yaml')
const WORKSPACE_ROOTS = ['apps', 'packages']
export const MANIFEST_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

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

export type ManifestDependencies = Partial<Record<(typeof MANIFEST_FIELDS)[number], Record<string, string>>>

export type ManifestIssue = {
  filePath: string
  message: string
}

export type ManifestEntry = {
  filePath: string
  manifest: ManifestDependencies
}

export type SingletonDependencyValidationInput = {
  lockfileContent?: string | null
  manifests: ManifestEntry[]
  overrides: Record<string, string>
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function collectWorkspacePackageJsonFiles(): string[] {
  const manifests: string[] = []

  for (const root of WORKSPACE_ROOTS) {
    const absoluteRoot = path.resolve(ROOT_DIR, root)
    if (!fs.existsSync(absoluteRoot)) continue

    for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(absoluteRoot, entry.name, 'package.json')
      if (fs.existsSync(manifestPath)) {
        manifests.push(manifestPath)
      }
    }
  }

  return manifests.sort((left, right) => left.localeCompare(right))
}

function toRelativePath(filePath: string): string {
  return path.isAbsolute(filePath) ? path.relative(ROOT_DIR, filePath) : filePath
}

export function isValidSemverRange(value: string): boolean {
  return semver.validRange(value) !== null
}

function acceptsResolvedVersion(versionRange: string, resolvedVersion: string): boolean {
  return semver.satisfies(resolvedVersion, versionRange, { includePrerelease: true })
}

function collectOverrideIssues(overrides: Record<string, string>): ManifestIssue[] {
  return Object.entries(overrides)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .flatMap(([packageName, overrideRange]) =>
      isValidSemverRange(overrideRange)
        ? []
        : [
            {
              filePath: 'pnpm-workspace.yaml',
              message: `overrides["${packageName}"] deve ser um semver/range valido; encontrado "${overrideRange}"`,
            },
          ],
    )
}

function buildResolvedVersionsByPackage(
  lockfileContent: string | null | undefined,
  packageNames: string[],
): Map<string, string[]> {
  const versionsByPackage = new Map<string, string[]>()

  for (const packageName of packageNames) {
    versionsByPackage.set(packageName, lockfileContent ? collectLockfileVersions(lockfileContent, packageName) : [])
  }

  return versionsByPackage
}

function collectManifestCompatibilityIssues(
  manifestEntry: ManifestEntry,
  overrides: Record<string, string>,
  resolvedVersionsByPackage: Map<string, string[]>,
): ManifestIssue[] {
  const relativePath = toRelativePath(manifestEntry.filePath)
  const issues: ManifestIssue[] = []

  for (const [packageName, overrideRange] of Object.entries(overrides)) {
    const resolvedVersions = resolvedVersionsByPackage.get(packageName) ?? []
    if (resolvedVersions.length !== 1) continue

    const resolvedVersion = resolvedVersions[0]

    for (const field of MANIFEST_FIELDS) {
      const declaredVersion = manifestEntry.manifest[field]?.[packageName]
      if (!declaredVersion) continue

      if (!isValidSemverRange(declaredVersion) || !acceptsResolvedVersion(declaredVersion, resolvedVersion)) {
        issues.push({
          filePath: relativePath,
          message: `"${packageName}" em "${field}" deve aceitar a versao singleton resolvida "${resolvedVersion}" (override: "${overrideRange}"); encontrado "${declaredVersion}"`,
        })
      }
    }
  }

  return issues
}

export function collectLockfileVersions(lockfileContent: string, packageName: string): string[] {
  const pattern = new RegExp(`^\\s{2}${escapeRegExp(packageName)}@([^:\\n]+):$`, 'gm')
  const versions = new Set<string>()

  for (const match of lockfileContent.matchAll(pattern)) {
    const normalizedVersion = match[1].split('(')[0].trim()
    if (normalizedVersion.length > 0) {
      versions.add(normalizedVersion)
    }
  }

  return Array.from(versions).sort((left, right) => left.localeCompare(right))
}

export function validateSingletonDependencyPolicy(input: SingletonDependencyValidationInput): ManifestIssue[] {
  const issues: ManifestIssue[] = [...collectOverrideIssues(input.overrides)]
  const packageNames = Object.keys(input.overrides).sort((left, right) => left.localeCompare(right))
  const resolvedVersionsByPackage = buildResolvedVersionsByPackage(input.lockfileContent, packageNames)

  for (const packageName of packageNames) {
    const overrideRange = input.overrides[packageName]
    const resolvedVersions = resolvedVersionsByPackage.get(packageName) ?? []

    if (resolvedVersions.length > 1) {
      issues.push({
        filePath: 'pnpm-lock.yaml',
        message: `"${packageName}" aparece com multiplas versoes no lockfile: ${resolvedVersions.join(', ')}`,
      })
      continue
    }

    if (
      resolvedVersions.length === 1 &&
      isValidSemverRange(overrideRange) &&
      !acceptsResolvedVersion(overrideRange, resolvedVersions[0])
    ) {
      issues.push({
        filePath: 'pnpm-lock.yaml',
        message: `"${packageName}" resolve para "${resolvedVersions[0]}" no lockfile, mas pnpm-workspace.yaml overrides exige compatibilidade com "${overrideRange}"`,
      })
    }
  }

  for (const manifestEntry of input.manifests) {
    issues.push(...collectManifestCompatibilityIssues(manifestEntry, input.overrides, resolvedVersionsByPackage))
  }

  return issues
}

function printIssues(issues: ManifestIssue[]): void {
  for (const issue of issues) {
    console.info(`${colors.gray}${issue.filePath}${colors.reset}`)
    console.info(`  ${colors.red}→${colors.reset} ${issue.message}`)
  }
}

function main(): void {
  console.info(`${colors.bright}${colors.blue}🔒 Checking singleton dependency compatibility...${colors.reset}`)

  if (!fs.existsSync(ROOT_PACKAGE_JSON_PATH)) {
    console.error(`${colors.red}Root package.json not found.${colors.reset}`)
    process.exit(1)
  }

  const rootManifest = readJsonFile<ManifestDependencies>(ROOT_PACKAGE_JSON_PATH)
  const overrides = readPnpmWorkspaceOverrides()
  const overrideEntries = Object.entries(overrides).sort((left, right) => left[0].localeCompare(right[0]))

  if (overrideEntries.length === 0) {
    console.info(`${colors.yellow}No pnpm-workspace.yaml overrides configured. Singleton dependency guard skipped.${colors.reset}`)
    process.exit(0)
  }

  const manifests: ManifestEntry[] = [{ filePath: ROOT_PACKAGE_JSON_PATH, manifest: rootManifest }]

  for (const manifestPath of collectWorkspacePackageJsonFiles()) {
    const manifest = readJsonFile<ManifestDependencies>(manifestPath)
    manifests.push({ filePath: manifestPath, manifest })
  }

  const issues: ManifestIssue[] = []

  if (!fs.existsSync(LOCKFILE_PATH)) {
    issues.push({
      filePath: 'pnpm-lock.yaml',
      message: 'pnpm-lock.yaml não encontrado',
    })
  } else {
    const lockfileContent = fs.readFileSync(LOCKFILE_PATH, 'utf8')
    issues.push(...validateSingletonDependencyPolicy({ lockfileContent, manifests, overrides }))
  }

  if (issues.length > 0) {
    console.info(`${colors.bright}${colors.red}⚠️  SINGLETON DEPENDENCY POLICY VIOLATION${colors.reset}\n`)
    printIssues(issues)
    console.info(`\n${colors.red}Ajuste os manifests/lockfile para manter dependências singleton alinhadas.${colors.reset}`)
    process.exit(1)
  }

  console.info(`${colors.green}${colors.bright}✅ [OK]${colors.reset} Singleton dependencies are compatible with pnpm-workspace.yaml overrides`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
