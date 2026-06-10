// @ts-nocheck
import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const inputDirs = process.argv.slice(2)
const outputDirs = inputDirs.length > 0 ? inputDirs : ['dist']
const forbiddenPattern = /(^|\/)__tests__(\/|$)|\.(test|spec)\.(cjs|mjs|js|jsx|ts|tsx|cts|mts|d\.ts)$/i

async function collectFilesRecursively(dir, rootDir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(absolutePath, rootDir)))
      continue
    }
    if (entry.isFile()) {
      const rel = relative(rootDir, absolutePath).replaceAll('\\', '/')
      files.push(rel)
    }
  }

  return files
}

let hasViolations = false

for (const outputDir of outputDirs) {
  const absoluteOutputDir = resolve(process.cwd(), outputDir)
  let files = []
  try {
    files = await collectFilesRecursively(absoluteOutputDir, absoluteOutputDir)
  } catch (error) {
    hasViolations = true
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[dist-check] Could not read ${outputDir}: ${message}`)
    continue
  }
  const violations = files.filter((file) => forbiddenPattern.test(file))

  if (violations.length === 0) {
    continue
  }

  hasViolations = true
  console.error(`[dist-check] Found test artifacts in ${outputDir}:`)
  for (const file of violations) {
    console.error(`  - ${file}`)
  }
}

if (hasViolations) {
  process.exitCode = 1
}
