import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { WebToolkitCliConfig } from './config.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

function findRepoRoot(startDir: string): string {
  let currentDir = startDir
  while (true) {
    if (fs.existsSync(path.join(currentDir, 'package.json')) && fs.existsSync(path.join(currentDir, 'pnpm-workspace.yaml'))) return currentDir
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) throw new Error('Could not find repo root from the current working directory.')
    currentDir = parentDir
  }
}

function readRequiredPnpmVersion(repoRoot: string): string {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { packageManager?: string }
  const packageManager = String(packageJson.packageManager || '')
  if (!packageManager.startsWith('pnpm@')) throw new Error(`Expected packageManager to start with pnpm@ but found ${JSON.stringify(packageManager)}.`)
  const version = packageManager.slice('pnpm@'.length).trim()
  if (!version || version.includes(' ') || version === 'latest' || version === '11') {
    throw new Error(`packageManager must pin an exact pnpm version, but found ${JSON.stringify(packageManager)}.`)
  }
  return version
}

function resolveNodeSiblingBinary(baseName: string): string {
  const binaryName = process.platform === 'win32' ? `${baseName}.cmd` : baseName
  const candidate = path.join(path.dirname(process.execPath), binaryName)
  return fs.existsSync(candidate) ? candidate : binaryName
}

function buildEnv(repoRoot: string, runtime: Runtime): NodeJS.ProcessEnv {
  return {
    ...process.env,
    COREPACK_HOME: path.join(repoRoot, runtime.config.environment?.corepackHome ?? '.corepack'),
  }
}

function spawnTool(command: string, args: string[], repoRoot: string, runtime: Runtime, options: Parameters<typeof spawnSync>[2] = {}) {
  const useShell = process.platform === 'win32'
  const direct = command === process.execPath || command.toLowerCase().endsWith('.exe')
  if (!useShell || direct) {
    return spawnSync(command, args, { cwd: repoRoot, env: buildEnv(repoRoot, runtime), shell: false, ...options })
  }
  return spawnSync([command, ...args].map(quoteForShell).join(' '), { cwd: repoRoot, env: buildEnv(repoRoot, runtime), shell: true, ...options })
}

function quoteForShell(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/u.test(value)) return value
  return `"${String(value).replace(/"/gu, '""')}"`
}

function captureCommand(command: string, args: string[], repoRoot: string, runtime: Runtime): string {
  const result = spawnTool(command, args, repoRoot, runtime, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim()
    throw new Error(`Command failed: ${command} ${args.join(' ')}${detail ? `\n${detail}` : ''}`)
  }
  return String(result.stdout).trim()
}

function runCommand(command: string, args: string[], repoRoot: string, runtime: Runtime): void {
  const result = spawnTool(command, args, repoRoot, runtime, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(' ')}`)
}

function assertNodeMajor(runtime: Runtime): void {
  const required = runtime.config.environment?.requiredNodeMajor
  if (!required) return
  const major = Number(process.versions.node.split('.')[0])
  if (major !== required) throw new Error(`Expected Node ${required}.x but found ${process.versions.node}.`)
}

function walkRepo(currentDir: string, onFile: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.pnpm-store', '.turbo', 'dist'].includes(entry.name)) continue
    const entryPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) walkRepo(entryPath, onFile)
    else if (entry.isFile()) onFile(entryPath)
  }
}

function readTrimmedFile(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trim() : ''
}

export function runEnvBootstrap(runtime: Runtime): void {
  const repoRoot = findRepoRoot(runtime.cwd)
  const requiredPnpmVersion = readRequiredPnpmVersion(repoRoot)
  const nodeInstallDir = path.dirname(process.execPath)
  const npmCliPath = path.join(nodeInstallDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')

  assertNodeMajor(runtime)
  if (!fs.existsSync(npmCliPath)) throw new Error(`npm CLI was not found under the active Node installation: ${npmCliPath}`)

  const corepack = resolveNodeSiblingBinary('corepack')
  if (!fs.existsSync(corepack)) {
    console.info('Corepack was not found in the active Node installation. Installing it via npm...')
    runCommand(process.execPath, [npmCliPath, 'install', '--global', '--force', 'corepack'], repoRoot, runtime)
  }

  runCommand(corepack, ['enable'], repoRoot, runtime)
  runCommand(corepack, ['prepare', `pnpm@${requiredPnpmVersion}`, '--activate'], repoRoot, runtime)

  console.info(`Node: ${process.versions.node}`)
  console.info(`npm: ${captureCommand(process.execPath, [npmCliPath, '--version'], repoRoot, runtime)}`)
  console.info(`pnpm: ${captureCommand(resolveNodeSiblingBinary('pnpm'), ['--version'], repoRoot, runtime)}`)
  console.info(`node path: ${process.execPath}`)
  console.info(`npm path: ${npmCliPath}`)
  console.info(`pnpm path: ${resolveNodeSiblingBinary('pnpm')}`)
  console.info(`repo root: ${repoRoot}`)
}

export function runEnvDoctor(runtime: Runtime): void {
  const repoRoot = findRepoRoot(runtime.cwd)
  const requiredNodeMajor = runtime.config.environment?.requiredNodeMajor
  const requiredPnpmVersion = readRequiredPnpmVersion(repoRoot)
  const failures: string[] = []

  if (requiredNodeMajor && Number(process.versions.node.split('.')[0]) !== requiredNodeMajor) {
    failures.push(`Expected Node ${requiredNodeMajor}.x but found ${process.versions.node}.`)
  }

  if (requiredNodeMajor && readTrimmedFile(path.join(repoRoot, '.nvmrc')) !== String(requiredNodeMajor)) {
    failures.push(`.nvmrc must be ${requiredNodeMajor}.`)
  }
  if (requiredNodeMajor && readTrimmedFile(path.join(repoRoot, '.node-version')) !== String(requiredNodeMajor)) {
    failures.push(`.node-version must be ${requiredNodeMajor}.`)
  }

  try {
    const pnpmVersion = captureCommand(resolveNodeSiblingBinary('pnpm'), ['--version'], repoRoot, runtime)
    if (pnpmVersion !== requiredPnpmVersion) failures.push(`Expected pnpm ${requiredPnpmVersion} but found ${pnpmVersion}.`)
  } catch (error) {
    failures.push((error as Error).message)
  }

  const packageLockfiles: string[] = []
  const yarnLockfiles: string[] = []
  const extraPnpmLockfiles: string[] = []
  walkRepo(repoRoot, (filePath) => {
    const relativePath = path.relative(repoRoot, filePath).split(path.sep).join('/')
    const basename = path.basename(filePath)
    if (basename === 'package-lock.json') packageLockfiles.push(relativePath)
    if (basename === 'yarn.lock') yarnLockfiles.push(relativePath)
    if (basename === 'pnpm-lock.yaml' && relativePath !== 'pnpm-lock.yaml') extraPnpmLockfiles.push(relativePath)
  })

  if (packageLockfiles.length > 0) failures.push(`Unexpected package-lock.json files: ${packageLockfiles.join(', ')}`)
  if (yarnLockfiles.length > 0) failures.push(`Unexpected yarn.lock files: ${yarnLockfiles.join(', ')}`)
  if (extraPnpmLockfiles.length > 0) failures.push(`Unexpected nested pnpm-lock.yaml files: ${extraPnpmLockfiles.join(', ')}`)

  let currentDir = path.dirname(repoRoot)
  while (true) {
    const parentNodeModules = path.join(currentDir, 'node_modules')
    if (fs.existsSync(parentNodeModules)) failures.push(`Parent node_modules detected outside repo root: ${parentNodeModules}`)
    const nextDir = path.dirname(currentDir)
    if (nextDir === currentDir) break
    currentDir = nextDir
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`)
    process.exit(1)
  }

  console.info('Environment doctor passed.')
}
