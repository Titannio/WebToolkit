import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

export type CleanLevel = 'empty' | 'cache' | 'deep' | 'nuclear'
export type ReinstallPolicy = 'ask' | 'always' | 'never'
export type RemovalKind = 'dir' | 'file' | 'empty-dir'

export type CleanerOptions = {
  level?: CleanLevel
  dryRun: boolean
  noStorePrune: boolean
  interactive: boolean
  reinstall: ReinstallPolicy
}

export type Removal = {
  kind: RemovalKind
  relPath: string
}

export type LevelConfig = {
  label: string
  removeEmptyDirs: boolean
  removableDirNames: string[]
  removableFileNames: string[]
  removableFileSuffixes: string[]
  removableFilePrefixes: string[]
  removableFilePatterns: string[]
  removableSpecificFiles: string[]
}

export type CleanerConfig = {
  workspaceRootNames: string[]
  protectedRootNames: string[]
  skipEmptyDirNames: string[]
  skipArtifactDirNames: string[]
  levels: Record<CleanLevel, LevelConfig>
}

export type WebToolkitCliConfig = {
  packageManager: string
  cleaner: CleanerConfig
  tasks: Record<string, TaskConfig>
  workspaceTests?: WorkspaceTestsConfig
  repoCheck?: RepoCheckConfig
  releaseGate?: ReleaseGateConfig
  validate?: ValidateConfig
  jsdocReport?: JSDocReportConfig
  bundleAudit?: BundleAuditConfig
  upgrade?: UpgradeConfig
  devWatch?: DevWatchConfig
  devGrid?: DevGridConfig
  environment?: EnvironmentConfig
}

export type TaskOutputMode = 'inherit' | 'buffered'

export type TaskStepConfig = {
  label: string
  builtinGuard?: string
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  appendArgs?: boolean
  outputMode?: TaskOutputMode
}

export type TaskConfig = {
  title?: string
  failFast?: boolean
  outputMode?: TaskOutputMode
  steps: TaskStepConfig[]
}

export type WorkspaceTargetConfig = {
  name: string
  package: string
  path: string
}

export type WorkspaceTestsConfig = {
  workspaces: WorkspaceTargetConfig[]
  errorLogFile?: string
  testFilePattern?: string
  ignoreDirNames?: string[]
  maxFailureExcerptLines?: number
}

export type RepoCheckConfig = {
  title?: string
  failFast?: boolean
  steps: TaskStepConfig[]
}

export type ReleaseGateStageConfig = {
  name: string
  command?: string
  args?: string[]
  package?: string
  script?: string
  files?: string[]
}

export type ReleaseGateConfig = {
  stages: ReleaseGateStageConfig[]
}

export type ValidateConfig = {
  steps: TaskStepConfig[]
  postSteps?: TaskStepConfig[]
}

export type JSDocReportConfig = {
  includePaths: string[]
  excludePatterns?: string[]
  reportFile?: string
  maxLineLength?: number
  promptForReport?: boolean
}

export type BundleAuditConfig = {
  appDirs: string[]
  top?: number
  rawWarningBytes?: number
}

export type UpgradeConfig = {
  defaultCooldownDays?: number
  protectedDependencyUpstreamHints?: Record<string, string[]>
  protectedOverridesFile?: string
  singletonGuardCommand?: TaskStepConfig
}

export type DevAppConfig = {
  displayName: string
  port: number
  filter?: string
  color?: string
}

export type DevWatchConfig = {
  apps: Record<string, DevAppConfig>
  defaultApps: string[]
  backendApp?: string
  host?: string
  backendPortCleanupGraceMs?: number
}

export type DevGridPaneConfig = {
  title: string
  command: string
  silentCommand?: string
}

export type DevGridConfig = {
  panes: DevGridPaneConfig[]
  fallbackScript?: string
  silentFallbackScript?: string
  preflightCommand?: TaskStepConfig
}

export type EnvironmentConfig = {
  requiredNodeMajor?: number
  packageManager?: string
  corepackHome?: string
}

type PartialLevelConfig = Partial<Omit<LevelConfig, 'removableFilePatterns'> & {
  removableFilePatterns: string[]
}>

type PartialCleanerConfig = Partial<Omit<CleanerConfig, 'levels'> & {
  levels: Partial<Record<CleanLevel, PartialLevelConfig>>
}>

type PartialWebToolkitCliConfig = Partial<Omit<WebToolkitCliConfig, 'cleaner'> & {
  cleaner: PartialCleanerConfig
  tasks: Record<string, TaskConfig>
}>

const configFileName = 'config.json'
const configDirName = '.webtoolkit-cli'

const cacheDirNames = [
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vite',
  '.next',
  '.nuxt',
  '.nyc_output',
  '.rpt2_cache',
  '.rts2_cache_cjs',
  '.rts2_cache_es',
  '.rts2_cache_umd',
  '.wrangler',
]

const deepDirNames = ['dist', 'build', 'coverage']
const cacheFileNames = ['.eslintcache', '.stylelintcache', 'vitest-results.json']
const deepFileSuffixes = ['.tsbuildinfo', '.lcov']
const deepFilePrefixes = ['vite.config.ts.timestamp-']
const deepFilePatterns = [
  '^npm-debug\\.log',
  '^yarn-debug\\.log',
  '^yarn-error\\.log',
  '^lerna-debug\\.log',
  '^\\.pnpm-debug\\.log',
  '^report\\.\\d+\\.\\d+\\.\\d+\\.\\d+\\.json$',
]

export const defaultConfig: WebToolkitCliConfig = {
  packageManager: 'pnpm',
    tasks: {},
  cleaner: {
    workspaceRootNames: ['apps', 'packages'],
    protectedRootNames: ['apps', 'scripts'],
    skipEmptyDirNames: [
      'node_modules',
      '.pnpm-store',
      '.git',
      '.idea',
      '.vscode',
      '.vercel',
      '.trae',
      '.agent',
    ],
    skipArtifactDirNames: ['.git'],
    levels: {
      empty: {
        label: 'Empty directories only',
        removeEmptyDirs: true,
        removableDirNames: [],
        removableFileNames: [],
        removableFileSuffixes: [],
        removableFilePrefixes: [],
        removableFilePatterns: [],
        removableSpecificFiles: [],
      },
      cache: {
        label: 'Caches and temp artifacts',
        removeEmptyDirs: true,
        removableDirNames: cacheDirNames,
        removableFileNames: cacheFileNames,
        removableFileSuffixes: [],
        removableFilePrefixes: [],
        removableFilePatterns: [],
        removableSpecificFiles: [],
      },
      deep: {
        label: 'Deep clean (without node_modules)',
        removeEmptyDirs: true,
        removableDirNames: [...cacheDirNames, ...deepDirNames],
        removableFileNames: cacheFileNames,
        removableFileSuffixes: deepFileSuffixes,
        removableFilePrefixes: deepFilePrefixes,
        removableFilePatterns: deepFilePatterns,
        removableSpecificFiles: [],
      },
      nuclear: {
        label: 'Nuclear clean',
        removeEmptyDirs: true,
        removableDirNames: [...cacheDirNames, ...deepDirNames, 'node_modules'],
        removableFileNames: cacheFileNames,
        removableFileSuffixes: deepFileSuffixes,
        removableFilePrefixes: deepFilePrefixes,
        removableFilePatterns: deepFilePatterns,
        removableSpecificFiles: [],
      },
    },
  },
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

export async function findConfigPath(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir)

  while (true) {
    const candidate = path.join(current, configDirName, configFileName)
    if (await pathExists(candidate)) return candidate

    const next = path.dirname(current)
    if (next === current) return null
    current = next
  }
}

function mergeLevelConfig(base: LevelConfig, override: PartialLevelConfig | undefined): LevelConfig {
  if (!override) return { ...base }

  return {
    label: override.label ?? base.label,
    removeEmptyDirs: override.removeEmptyDirs ?? base.removeEmptyDirs,
    removableDirNames: override.removableDirNames ?? base.removableDirNames,
    removableFileNames: override.removableFileNames ?? base.removableFileNames,
    removableFileSuffixes: override.removableFileSuffixes ?? base.removableFileSuffixes,
    removableFilePrefixes: override.removableFilePrefixes ?? base.removableFilePrefixes,
    removableFilePatterns: override.removableFilePatterns ?? base.removableFilePatterns,
    removableSpecificFiles: override.removableSpecificFiles ?? base.removableSpecificFiles,
  }
}

export function mergeConfig(override: PartialWebToolkitCliConfig = {}): WebToolkitCliConfig {
  const cleanerOverride = override.cleaner ?? {}

  return {
    packageManager: override.packageManager ?? defaultConfig.packageManager,
    tasks: override.tasks ?? defaultConfig.tasks,
    workspaceTests: override.workspaceTests,
    repoCheck: override.repoCheck,
    releaseGate: override.releaseGate,
    validate: override.validate,
    jsdocReport: override.jsdocReport,
    bundleAudit: override.bundleAudit,
    upgrade: override.upgrade,
    devWatch: override.devWatch,
    devGrid: override.devGrid,
    environment: override.environment,
    cleaner: {
      workspaceRootNames: cleanerOverride.workspaceRootNames ?? defaultConfig.cleaner.workspaceRootNames,
      protectedRootNames: cleanerOverride.protectedRootNames ?? defaultConfig.cleaner.protectedRootNames,
      skipEmptyDirNames: cleanerOverride.skipEmptyDirNames ?? defaultConfig.cleaner.skipEmptyDirNames,
      skipArtifactDirNames: cleanerOverride.skipArtifactDirNames ?? defaultConfig.cleaner.skipArtifactDirNames,
      levels: {
        empty: mergeLevelConfig(defaultConfig.cleaner.levels.empty, cleanerOverride.levels?.empty),
        cache: mergeLevelConfig(defaultConfig.cleaner.levels.cache, cleanerOverride.levels?.cache),
        deep: mergeLevelConfig(defaultConfig.cleaner.levels.deep, cleanerOverride.levels?.deep),
        nuclear: mergeLevelConfig(defaultConfig.cleaner.levels.nuclear, cleanerOverride.levels?.nuclear),
      },
    },
  }
}

export async function loadConfig(cwd: string): Promise<{ config: WebToolkitCliConfig; configPath: string | null }> {
  const configPath = await findConfigPath(cwd)
  if (!configPath) return { config: mergeConfig(), configPath: null }

  const raw = await readFile(configPath, 'utf8')
  const parsed = JSON.parse(raw) as PartialWebToolkitCliConfig
  return { config: mergeConfig(parsed), configPath }
}
