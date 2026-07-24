import { spawnSync } from 'node:child_process'
import type { RepositoryHygieneGuardConfig } from '../config.js'
import { compilePatterns, isMainModule, loadGuardConfig } from './guard-config.js'

export type RepositoryHygieneIssue = {
  filePath: string
  pattern: string
}

function normalizeTrackedPath(filePath: string): string {
  return filePath.replaceAll('\\', '/')
}

export function readTrackedFiles(rootDir: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: rootDir,
    encoding: 'utf8',
    shell: false,
  })

  if (result.error) {
    throw new Error(`repository-hygiene: unable to list Git-tracked files: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim()
    /* v8 ignore next -- Git reports command failures on stderr */
    throw new Error(`repository-hygiene: git ls-files failed${detail ? `: ${detail}` : '.'}`)
  }

  const files = result.stdout
    .split('\0')
    .filter(Boolean)
    .map(normalizeTrackedPath)

  if (files.length === 0) {
    throw new Error('repository-hygiene: git ls-files returned no tracked files.')
  }
  return files
}

export function inspectTrackedPaths(
  trackedFiles: string[],
  config: RepositoryHygieneGuardConfig,
): RepositoryHygieneIssue[] {
  const forbidden = compilePatterns(config.forbiddenPathPatterns)
  const allowed = compilePatterns(config.allowedPathPatterns)
  const issues: RepositoryHygieneIssue[] = []

  for (const filePath of trackedFiles.map(normalizeTrackedPath)) {
    if (allowed.some((pattern) => pattern.test(filePath))) continue
    const index = forbidden.findIndex((pattern) => pattern.test(filePath))
    if (index >= 0) {
      issues.push({ filePath, pattern: config.forbiddenPathPatterns[index] })
    }
  }

  return issues.sort((left, right) => Buffer.compare(Buffer.from(left.filePath), Buffer.from(right.filePath)))
}

export async function runRepositoryHygieneGuard(options: {
  rootDir?: string
  config?: RepositoryHygieneGuardConfig
  trackedFiles?: string[]
} = {}): Promise<number> {
  const rootDir = options.rootDir ?? process.cwd()
  const config = options.config ?? await loadGuardConfig('repositoryHygiene', rootDir)
  const trackedFiles = options.trackedFiles ?? readTrackedFiles(rootDir)
  if (trackedFiles.length === 0) {
    throw new Error('repository-hygiene: tracked-file inventory must not be empty.')
  }

  const issues = inspectTrackedPaths(trackedFiles, config)
  if (issues.length === 0) {
    console.info(`Repository hygiene is valid (${trackedFiles.length} tracked files).`)
    return 0
  }

  console.error('Repository hygiene guard failed:')
  for (const issue of issues) {
    console.error(`  - ${issue.filePath} [${issue.pattern}]`)
  }
  return 1
}

/* v8 ignore start -- executable adapter */
if (isMainModule(import.meta.url)) {
  runRepositoryHygieneGuard().then((code) => {
    process.exitCode = code
  }).catch((error: unknown) => {
    console.error((error as Error).message)
    process.exitCode = 1
  })
}
/* v8 ignore stop */
