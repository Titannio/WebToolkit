import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

type DependencyCruiserGuardOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  execPath?: string
  searchStart?: string
  exists?: (target: string) => boolean
  readFile?: (target: string, encoding: BufferEncoding) => string
  spawn?: typeof spawnSync
  error?: (message?: unknown) => void
}

function findDependencyCruiserPackageRoot(
  searchStart: string,
  exists: (target: string) => boolean,
  readFile: (target: string, encoding: BufferEncoding) => string,
): string {
  let current = searchStart

  while (true) {
    if (path.basename(current) !== 'node_modules') {
      const manifestPath = path.join(current, 'node_modules', 'dependency-cruiser', 'package.json')
      if (exists(manifestPath)) {
        const manifest = JSON.parse(readFile(manifestPath, 'utf8')) as { name?: string }
        if (manifest.name === 'dependency-cruiser') {
          return path.dirname(manifestPath)
        }
      }
    }

    const directManifestPath = path.join(current, 'package.json')
    if (exists(directManifestPath)) {
      const manifest = JSON.parse(readFile(directManifestPath, 'utf8')) as { name?: string }
      if (manifest.name === 'dependency-cruiser') {
        return current
      }
    }

    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error(`Could not find dependency-cruiser package root from ${searchStart}.`)
    }
    current = parent
  }
}

export function resolveDependencyCruiserBin(options: DependencyCruiserGuardOptions = {}): string {
  const exists = options.exists ?? existsSync
  const readFile = options.readFile ?? readFileSync
  const searchStart = options.searchStart ?? path.dirname(fileURLToPath(import.meta.url))
  const packageRoot = findDependencyCruiserPackageRoot(searchStart, exists, readFile)
  const binPath = path.join(packageRoot, 'bin', 'dependency-cruise.mjs')

  if (!exists(binPath)) {
    throw new Error(`dependency-cruiser binary not found at ${binPath}.`)
  }

  return binPath
}

export function runDependencyCruiserGuard(args: string[], options: DependencyCruiserGuardOptions = {}): number {
  const writeError = options.error ?? console.error
  let binPath: string

  try {
    binPath = resolveDependencyCruiserBin(options)
  } catch (error) {
    writeError(`Dependency Cruiser guard is unavailable: ${(error as Error).message}`)
    writeError('The dependency-cruiser runtime dependency must be resolvable from @titannio/webtoolkit-cli.')
    return 1
  }

  const result = (options.spawn ?? spawnSync)(options.execPath ?? process.execPath, [binPath, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...(options.env ?? process.env),
      FORCE_COLOR: '1',
    },
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  return result.status ?? 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runDependencyCruiserGuard(process.argv.slice(2)))
}
