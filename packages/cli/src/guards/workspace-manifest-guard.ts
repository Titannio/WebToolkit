import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type {
  WorkspaceManifestGuardConfig,
  WorkspacePeerRequirementConfig,
} from '../config.js'
import {
  assertConfiguredScanScope,
  isMainModule,
  loadGuardConfig,
  resolveProjectPath,
} from './guard-config.js'
import {
  MANIFEST_FIELDS,
  type ManifestDependencies,
} from './singleton-deps-guard.js'

const require = createRequire(import.meta.url)
const semver = require('semver') as typeof import('semver')
const runtimeFields = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

type WorkspaceManifest = ManifestDependencies & {
  name?: unknown
}

type LoadedManifest = {
  absoluteDirectory: string
  filePath: string
  manifest: WorkspaceManifest
}

export type WorkspaceManifestIssue = {
  filePath: string
  dependency?: string
  message: string
}

function normalizedRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replaceAll('\\', '/')
}

function pathKey(value: string): string {
  const normalized = path.resolve(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function readManifest(rootDir: string, manifestPath: string): LoadedManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`${normalizedRelativePath(rootDir, manifestPath)}: invalid package.json: ${(error as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${normalizedRelativePath(rootDir, manifestPath)}: package.json must contain an object.`)
  }
  return {
    absoluteDirectory: path.dirname(manifestPath),
    filePath: normalizedRelativePath(rootDir, manifestPath),
    manifest: parsed as WorkspaceManifest,
  }
}

function collectManifests(rootDir: string, packageRoots: string[]): LoadedManifest[] {
  const manifestPaths: string[] = []

  for (const configuredRoot of packageRoots) {
    const absoluteRoot = resolveProjectPath(rootDir, configuredRoot)
    if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) continue

    for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(absoluteRoot, entry.name, 'package.json')
      if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
        manifestPaths.push(manifestPath)
      }
    }
  }

  assertConfiguredScanScope({
    root: rootDir,
    guardName: 'workspace-manifest',
    configPath: 'guards.workspaceManifest.packageRoots',
    configuredPaths: packageRoots,
    eligibleFiles: manifestPaths,
  })

  return manifestPaths.sort().map((manifestPath) => readManifest(rootDir, manifestPath))
}

function isValidWorkspaceRange(value: string): boolean {
  const range = value.slice('workspace:'.length)
  return range === '*' || range === '^' || range === '~' || semver.validRange(range) !== null
}

function hasNonSemverProtocol(value: string): boolean {
  return /^(?:file|link|npm|git(?:\+\w+)?|https?|ssh|github|gitlab|bitbucket):/u.test(value)
}

function isValidVersionSpecifier(value: string, field: (typeof MANIFEST_FIELDS)[number]): boolean {
  if (value.startsWith('workspace:')) return isValidWorkspaceRange(value)
  if (semver.validRange(value) !== null || hasNonSemverProtocol(value)) return true
  return field !== 'peerDependencies' && /^[A-Za-z][\w.-]*$/u.test(value)
}

function dependencyEntries(manifest: WorkspaceManifest): Array<{
  field: (typeof MANIFEST_FIELDS)[number]
  dependency: string
  version: string
}> {
  return MANIFEST_FIELDS.flatMap((field) => (
    Object.entries(manifest[field] ?? {}).map(([dependency, version]) => ({
      field,
      dependency,
      version,
    }))
  ))
}

function requirementPackage(
  rootDir: string,
  manifestByDirectory: Map<string, LoadedManifest>,
  configuredPath: string,
  configPath: string,
): LoadedManifest {
  const absoluteDirectory = resolveProjectPath(rootDir, configuredPath)
  const loaded = manifestByDirectory.get(pathKey(absoluteDirectory))
  if (!loaded) {
    throw new Error(
      `workspace-manifest: ${configPath} must reference a discovered workspace package containing package.json: ${configuredPath}`,
    )
  }
  return loaded
}

function checkPeerRequirement(
  rootDir: string,
  requirement: WorkspacePeerRequirementConfig,
  index: number,
  manifestByDirectory: Map<string, LoadedManifest>,
): WorkspaceManifestIssue[] {
  const issues: WorkspaceManifestIssue[] = []

  for (const [providerIndex, providerPath] of requirement.providers.entries()) {
    const provider = requirementPackage(
      rootDir,
      manifestByDirectory,
      providerPath,
      `guards.workspaceManifest.peerRequirements[${index}].providers[${providerIndex}]`,
    )
    if (!provider.manifest.peerDependencies?.[requirement.dependency]) {
      issues.push({
        filePath: provider.filePath,
        dependency: requirement.dependency,
        message: 'must be declared in peerDependencies for this provider',
      })
    }
    if (
      provider.manifest.dependencies?.[requirement.dependency] ||
      provider.manifest.optionalDependencies?.[requirement.dependency]
    ) {
      issues.push({
        filePath: provider.filePath,
        dependency: requirement.dependency,
        message: 'must not be declared in provider runtime dependencies',
      })
    }
  }

  for (const [consumerIndex, consumerPath] of requirement.consumers.entries()) {
    const consumer = requirementPackage(
      rootDir,
      manifestByDirectory,
      consumerPath,
      `guards.workspaceManifest.peerRequirements[${index}].consumers[${consumerIndex}]`,
    )
    const directRuntimeDeclaration = runtimeFields.some((field) => (
      Boolean(consumer.manifest[field]?.[requirement.dependency])
    ))
    if (!directRuntimeDeclaration) {
      issues.push({
        filePath: consumer.filePath,
        dependency: requirement.dependency,
        message: 'must be declared directly in a runtime dependency section for this consumer',
      })
    }
  }
  return issues
}

export function inspectWorkspaceManifests(
  rootDir: string,
  manifests: LoadedManifest[],
  config: WorkspaceManifestGuardConfig,
): WorkspaceManifestIssue[] {
  const issues: WorkspaceManifestIssue[] = []
  const manifestsByName = new Map<string, LoadedManifest>()
  const duplicateNames = new Set<string>()

  for (const loaded of manifests) {
    if (typeof loaded.manifest.name !== 'string' || loaded.manifest.name.trim() === '') {
      issues.push({ filePath: loaded.filePath, message: 'workspace package name is required' })
      continue
    }
    const existing = manifestsByName.get(loaded.manifest.name)
    if (existing) {
      duplicateNames.add(loaded.manifest.name)
      issues.push({
        filePath: loaded.filePath,
        dependency: loaded.manifest.name,
        message: `duplicates workspace package name from ${existing.filePath}`,
      })
    } else {
      manifestsByName.set(loaded.manifest.name, loaded)
    }
  }

  const internalNames = new Set(
    [...manifestsByName.keys()].filter((name) => !duplicateNames.has(name)),
  )
  for (const loaded of manifests) {
    for (const { field, dependency, version } of dependencyEntries(loaded.manifest)) {
      if (!isValidVersionSpecifier(version, field)) {
        issues.push({
          filePath: loaded.filePath,
          dependency,
          message: `has invalid version range ${JSON.stringify(version)} in ${field}`,
        })
      }
      if (
        config.requireWorkspaceProtocol &&
        internalNames.has(dependency) &&
        !version.startsWith('workspace:')
      ) {
        issues.push({
          filePath: loaded.filePath,
          dependency,
          message: `must use the workspace: protocol in ${field}`,
        })
      }
    }

    const dependencies = new Set(runtimeFields.flatMap((field) => (
      Object.keys(loaded.manifest[field] ?? {})
    )))
    for (const dependency of dependencies) {
      const declaredFields = runtimeFields.filter((field) => (
        Boolean(loaded.manifest[field]?.[dependency])
      ))
      if (declaredFields.length > 1) {
        issues.push({
          filePath: loaded.filePath,
          dependency,
          message: `is declared in conflicting runtime sections: ${declaredFields.join(', ')}`,
        })
      }
    }
  }

  const manifestByDirectory = new Map(
    manifests.map((loaded) => [pathKey(loaded.absoluteDirectory), loaded]),
  )
  for (const [index, requirement] of config.peerRequirements.entries()) {
    issues.push(...checkPeerRequirement(rootDir, requirement, index, manifestByDirectory))
  }

  return issues.sort((left, right) => (
    left.filePath.localeCompare(right.filePath) ||
    (left.dependency ?? '').localeCompare(right.dependency ?? '') ||
    left.message.localeCompare(right.message)
  ))
}

export async function runWorkspaceManifestGuard(options: {
  rootDir?: string
  config?: WorkspaceManifestGuardConfig
} = {}): Promise<number> {
  const rootDir = options.rootDir ?? process.cwd()
  const config = options.config ?? await loadGuardConfig('workspaceManifest', rootDir)
  /* v8 ignore next -- both outcomes are asserted; V8 omits the fallthrough branch */
  if (config.packageRoots.length === 0) {
    throw new Error('guards.workspaceManifest.packageRoots must not be empty.')
  }

  const manifests = collectManifests(rootDir, config.packageRoots)
  const issues = inspectWorkspaceManifests(rootDir, manifests, config)
  if (issues.length === 0) {
    console.info(`Workspace manifests are valid (${manifests.length} packages).`)
    return 0
  }

  console.error('Workspace manifest guard failed:')
  for (const issue of issues) {
    const dependency = issue.dependency ? ` [${issue.dependency}]` : ''
    console.error(`  - ${issue.filePath}${dependency}: ${issue.message}`)
  }
  return 1
}

/* v8 ignore start -- executable adapter */
if (isMainModule(import.meta.url)) {
  runWorkspaceManifestGuard().then((code) => {
    process.exitCode = code
  }).catch((error: unknown) => {
    console.error((error as Error).message)
    process.exitCode = 1
  })
}
/* v8 ignore stop */
