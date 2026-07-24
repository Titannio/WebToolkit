import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { PackageSurfaceGuardConfig } from '../config.js'
import { resolveSpawnSpec } from '../process.js'
import {
  compilePatterns,
  isMainModule,
  loadGuardConfig,
  resolveProjectPath,
} from './guard-config.js'

type PackageManifest = {
  main?: unknown
  module?: unknown
  types?: unknown
  typings?: unknown
  bin?: unknown
  exports?: unknown
}

type ManifestTarget = {
  field: string
  target: string
}

export type PackageSurfaceIssue = {
  packageDirectory: string
  field: string
  filePath: string
  message: string
}

export type PackCommandResult = {
  error?: Error
  status: number | null
  stdout: string
  stderr: string
}

type PackCommand = (packageDirectory: string) => PackCommandResult

function normalizePackagePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^\.\//u, '')
}

function childField(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`
}

function unsupportedTarget(
  packageDirectory: string,
  field: string,
  value: unknown,
): PackageSurfaceIssue {
  return {
    packageDirectory,
    field,
    filePath: '',
    message: `unsupported manifest target: ${JSON.stringify(value)}`,
  }
}

function collectExports(
  packageDirectory: string,
  field: string,
  value: unknown,
  targets: ManifestTarget[],
  issues: PackageSurfaceIssue[],
): void {
  if (value === null) return
  if (typeof value === 'string') {
    targets.push({ field, target: value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectExports(packageDirectory, `${field}[${index}]`, entry, targets, issues)
    })
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      collectExports(packageDirectory, childField(field, key), entry, targets, issues)
    }
    return
  }
  issues.push(unsupportedTarget(packageDirectory, field, value))
}

export function collectManifestTargets(
  packageDirectory: string,
  manifest: PackageManifest,
): { targets: ManifestTarget[]; issues: PackageSurfaceIssue[] } {
  const targets: ManifestTarget[] = []
  const issues: PackageSurfaceIssue[] = []

  for (const field of ['main', 'module', 'types', 'typings'] as const) {
    const value = manifest[field]
    if (value === undefined) continue
    if (typeof value === 'string') targets.push({ field, target: value })
    else issues.push(unsupportedTarget(packageDirectory, field, value))
  }

  if (manifest.bin !== undefined) {
    if (typeof manifest.bin === 'string') {
      targets.push({ field: 'bin', target: manifest.bin })
    } else if (manifest.bin && typeof manifest.bin === 'object' && !Array.isArray(manifest.bin)) {
      for (const [name, value] of Object.entries(manifest.bin)) {
        const field = childField('bin', name)
        if (typeof value === 'string') targets.push({ field, target: value })
        else issues.push(unsupportedTarget(packageDirectory, field, value))
      }
    } else {
      issues.push(unsupportedTarget(packageDirectory, 'bin', manifest.bin))
    }
  }

  if (manifest.exports !== undefined) {
    collectExports(packageDirectory, 'exports', manifest.exports, targets, issues)
  }
  return { targets, issues }
}

function runNpmPack(packageDirectory: string): PackCommandResult {
  const command = resolveSpawnSpec('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'])
  const result = spawnSync(command.command, command.args, {
    cwd: packageDirectory,
    encoding: 'utf8',
    shell: false,
  })
  return {
    error: result.error,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

export function readPackedFiles(
  packageDirectory: string,
  runPack: PackCommand = runNpmPack,
): string[] {
  const result = runPack(packageDirectory)
  if (result.error) {
    throw new Error(`package-surface: npm pack failed in ${packageDirectory}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim()
    throw new Error(
      `package-surface: npm pack failed in ${packageDirectory}${detail ? `: ${detail}` : '.'}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(
      `package-surface: invalid npm pack JSON in ${packageDirectory}: ${(error as Error).message}`,
    )
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(`package-surface: npm pack JSON in ${packageDirectory} must contain one package.`)
  }
  const files = (parsed[0] as { files?: unknown }).files
  if (!Array.isArray(files) || files.some((entry) => (
    !entry || typeof entry !== 'object' || typeof (entry as { path?: unknown }).path !== 'string'
  ))) {
    throw new Error(`package-surface: npm pack JSON in ${packageDirectory} has an invalid files list.`)
  }
  return files.map((entry) => normalizePackagePath((entry as { path: string }).path))
}

function loadManifest(
  rootDir: string,
  configuredDirectory: string,
): { absoluteDirectory: string; manifest: PackageManifest } {
  const absoluteDirectory = resolveProjectPath(rootDir, configuredDirectory)
  if (!fs.existsSync(absoluteDirectory) || !fs.statSync(absoluteDirectory).isDirectory()) {
    throw new Error(`package-surface: missing package directory: ${configuredDirectory}`)
  }
  const manifestPath = path.join(absoluteDirectory, 'package.json')
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new Error(`package-surface: package.json is missing in ${configuredDirectory}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `package-surface: invalid ${configuredDirectory}/package.json: ${(error as Error).message}`,
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`package-surface: ${configuredDirectory}/package.json must contain an object.`)
  }
  return { absoluteDirectory, manifest: parsed as PackageManifest }
}

function inspectTarget(
  packageDirectory: string,
  absoluteDirectory: string,
  target: ManifestTarget,
  packedFiles: Set<string>,
): PackageSurfaceIssue[] {
  if (target.target.includes('*')) {
    return [{
      packageDirectory,
      field: target.field,
      filePath: target.target,
      message: 'wildcard manifest targets are unsupported',
    }]
  }
  if (target.field.startsWith('exports') && !target.target.startsWith('./')) {
    return [{
      packageDirectory,
      field: target.field,
      filePath: target.target,
      message: 'export target must start with ./',
    }]
  }

  let absoluteTarget: string
  try {
    absoluteTarget = resolveProjectPath(absoluteDirectory, target.target)
  } catch (error) {
    return [{
      packageDirectory,
      field: target.field,
      filePath: target.target,
      message: (error as Error).message,
    }]
  }

  const filePath = normalizePackagePath(target.target)
  const issues: PackageSurfaceIssue[] = []
  if (!fs.existsSync(absoluteTarget) || !fs.statSync(absoluteTarget).isFile()) {
    issues.push({
      packageDirectory,
      field: target.field,
      filePath,
      message: 'public target is missing after build',
    })
  }
  if (!packedFiles.has(filePath)) {
    issues.push({
      packageDirectory,
      field: target.field,
      filePath,
      message: 'public target is excluded from the npm package',
    })
  }
  return issues
}

export async function runPackageSurfaceGuard(options: {
  rootDir?: string
  config?: PackageSurfaceGuardConfig
  runPack?: PackCommand
} = {}): Promise<number> {
  const rootDir = options.rootDir ?? process.cwd()
  const config = options.config ?? await loadGuardConfig('packageSurface', rootDir)
  const forbidden = compilePatterns(config.forbiddenPublishedPatterns)
  const issues: PackageSurfaceIssue[] = []

  for (const packageDirectory of config.packageDirectories) {
    const loaded = loadManifest(rootDir, packageDirectory)
    const collected = collectManifestTargets(packageDirectory, loaded.manifest)
    const packedFiles = readPackedFiles(loaded.absoluteDirectory, options.runPack)
    const packedSet = new Set(packedFiles)
    issues.push(...collected.issues)

    for (const target of collected.targets) {
      issues.push(...inspectTarget(
        packageDirectory,
        loaded.absoluteDirectory,
        target,
        packedSet,
      ))
    }
    for (const filePath of packedFiles) {
      const index = forbidden.findIndex((pattern) => pattern.test(filePath))
      if (index >= 0) {
        issues.push({
          packageDirectory,
          field: 'npm pack',
          filePath,
          message: `matches forbidden pattern ${config.forbiddenPublishedPatterns[index]}`,
        })
      }
    }
  }

  issues.sort((left, right) => (
    [left.packageDirectory, left.filePath, left.field, left.message].join('\0')
      .localeCompare([right.packageDirectory, right.filePath, right.field, right.message].join('\0'))
  ))
  if (issues.length === 0) {
    console.info(`Package surface is valid (${config.packageDirectories.length} packages).`)
    return 0
  }

  console.error('Package surface guard failed:')
  for (const issue of issues) {
    const filePath = issue.filePath ? ` ${issue.filePath}` : ''
    console.error(`  - ${issue.packageDirectory} [${issue.field}]${filePath}: ${issue.message}`)
  }
  return 1
}

/* v8 ignore start -- executable adapter */
if (isMainModule(import.meta.url)) {
  runPackageSurfaceGuard().then((code) => {
    process.exitCode = code
  }).catch((error: unknown) => {
    console.error((error as Error).message)
    process.exitCode = 1
  })
}
/* v8 ignore stop */
