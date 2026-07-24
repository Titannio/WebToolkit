import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { isMainModule } from './guard-config.js'

const forbiddenPattern = /(^|\/)__tests__(\/|$)|\.(test|spec)\.(cjs|mjs|js|jsx|ts|tsx|cts|mts|d\.ts)$/i

async function collectFilesRecursively(dir: string, rootDir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(absolutePath, rootDir)))
      continue
    }
    /* v8 ignore next -- non-file directory entries are intentionally ignored */
    if (!entry.isFile()) continue
    const rel = relative(rootDir, absolutePath).replaceAll('\\', '/')
    files.push(rel)
  }

  return files
}

export async function runNoTestsInDist(
  inputDirs: string[] = [],
  rootDir = process.cwd(),
): Promise<number> {
  const outputDirs = inputDirs.length > 0 ? inputDirs : ['dist']
  let hasViolations = false

  for (const outputDir of outputDirs) {
    const absoluteOutputDir = resolve(rootDir, outputDir)
    let files: string[] = []
    try {
      files = await collectFilesRecursively(absoluteOutputDir, absoluteOutputDir)
    } catch (error) {
      hasViolations = true
      console.error(`[dist-check] Could not read ${outputDir}: ${String(error)}`)
      continue
    }
    const violations = files.filter((file) => forbiddenPattern.test(file))

    if (violations.length === 0) continue

    hasViolations = true
    console.error(`[dist-check] Found test artifacts in ${outputDir}:`)
    for (const file of violations) {
      console.error(`  - ${file}`)
    }
  }

  return hasViolations ? 1 : 0
}

/* v8 ignore start -- executable adapter */
if (isMainModule(import.meta.url)) {
  runNoTestsInDist(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  }).catch((error: unknown) => {
    console.error((error as Error).message)
    process.exitCode = 1
  })
}
/* v8 ignore stop */
