import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GuardsConfig } from '../config.js'
import { loadConfig } from '../config.js'

export const BASE_ARTIFACT_EXCLUDE_PATTERNS = [
  '(^|[/\\\\])node_modules([/\\\\]|$)',
  '(^|[/\\\\])dist([/\\\\]|$)',
  '(^|[/\\\\])build([/\\\\]|$)',
  '(^|[/\\\\])coverage([/\\\\]|$)',
]

export const BASE_SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])

export const BASE_TYPESCRIPT_EXTENSIONS = new Set(['.cts', '.mts', '.ts', '.tsx'])
export const BASE_JSX_EXTENSIONS = new Set(['.jsx', '.tsx'])

export const BASE_SOURCE_EXCLUDE_PATTERNS = [
  ...BASE_ARTIFACT_EXCLUDE_PATTERNS,
  '\\.(test|spec)([.-]|$)',
  '(^|[/\\\\])tests?([/\\\\]|$)',
  '(^|[/\\\\])__tests__([/\\\\]|$)',
  '\\.stories\\.',
]

export const BASE_LAYER_EXCLUDE_PATTERNS = [
  ...BASE_SOURCE_EXCLUDE_PATTERNS,
  '\\.(config|setup)\\.',
]

export async function loadGuardConfig<K extends keyof GuardsConfig>(
  name: K,
  cwd = process.cwd(),
): Promise<NonNullable<GuardsConfig[K]>> {
  const { config, configPath } = await loadConfig(cwd)
  const guardConfig = config.guards?.[name]
  if (!configPath || !guardConfig) {
    throw new Error(`guards.${name} is not configured in .webtoolkit-cli/config.json.`)
  }
  return guardConfig as NonNullable<GuardsConfig[K]>
}

export function compilePatterns(patterns: string[] = [], basePatterns: string[] = []): RegExp[] {
  return [...basePatterns, ...patterns].map((pattern) => {
    try {
      return new RegExp(pattern)
    } catch {
      throw new Error(`Invalid regular expression in guard configuration: ${pattern}`)
    }
  })
}

export function hasExtension(filePath: string, extensions: Set<string>): boolean {
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return extensions.has(extension)
}

export function resolveProjectPath(root: string, configuredPath: string): string {
  const absolutePath = path.resolve(root, configuredPath)
  const relativePath = path.relative(root, absolutePath)
  if (path.isAbsolute(configuredPath) || relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) {
    throw new Error(`Guard path must stay inside the project: ${configuredPath}`)
  }
  return absolutePath
}

export function assertConfiguredScanScope(options: {
  root: string
  guardName: string
  configPath: string
  configuredPaths: string[]
  eligibleFiles: string[]
}): void {
  for (const configuredPath of options.configuredPaths) {
    const absolutePath = resolveProjectPath(options.root, configuredPath)
    let stats: fs.Stats

    try {
      stats = fs.statSync(absolutePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `${options.guardName}: ${options.configPath} contains a missing directory: ${configuredPath}`,
        )
      }
      throw error
    }

    if (!stats.isDirectory()) {
      throw new Error(
        `${options.guardName}: ${options.configPath} must contain directories; received: ${configuredPath}`,
      )
    }
  }

  if (options.eligibleFiles.length === 0) {
    throw new Error(
      `${options.guardName}: ${options.configPath} matched zero eligible files in: ${options.configuredPaths.join(', ')}`,
    )
  }
}

export function isMainModule(moduleUrl: string, argv = process.argv): boolean {
  return Boolean(argv[1])
    && fs.realpathSync(path.resolve(argv[1])) === fs.realpathSync(fileURLToPath(moduleUrl))
}
