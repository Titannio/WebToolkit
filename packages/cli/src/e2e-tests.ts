import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'

import type { E2eServerConfig, E2eTestsConfig, WebToolkitCliConfig } from './config.js'
import { resolveSpawnSpec, stopChildProcessTree } from './process.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

type ManagedServer = {
  config: E2eServerConfig
  child: ChildProcess
  output: string
  error?: Error
}

type PlaywrightBrowser = {
  executablePath(): string
}

const defaultTestFilePattern = '\\.spec\\.(ts|tsx|js|jsx)$'
const ignoredDirectoryNames = new Set(['node_modules', 'dist', 'build', 'coverage', '.git'])

export function getE2eConfig(config: WebToolkitCliConfig): E2eTestsConfig {
  if (!config.e2eTests) throw new Error('e2eTests is not configured.')
  return config.e2eTests
}

export function countE2eTestFiles(directory: string, pattern: RegExp): number {
  if (!fs.existsSync(directory)) return 0

  let count = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) count += countE2eTestFiles(entryPath, pattern)
    } else if (entry.isFile() && pattern.test(entry.name)) {
      count += 1
    }
  }
  return count
}

export function assertE2eFiles(rootDir: string, config: E2eTestsConfig): void {
  const testDirectory = path.join(rootDir, config.testDirectory)
  if (!fs.existsSync(testDirectory) || !fs.statSync(testDirectory).isDirectory()) {
    throw new Error(`Playwright test directory is missing: ${config.testDirectory}`)
  }

  const count = countE2eTestFiles(testDirectory, new RegExp(config.testFilePattern ?? defaultTestFilePattern))
  if (count === 0) throw new Error(`No Playwright tests match ${config.testFilePattern ?? defaultTestFilePattern} in ${config.testDirectory}.`)
}

export function createPlaywrightConfig(rootDir: string, config: E2eTestsConfig): { path: string, cleanup(): void } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webtoolkit-playwright-'))
  const configPath = path.join(directory, 'playwright.config.mjs')
  const options = {
    ...config.playwright.config,
    ...(process.env.CI ? config.playwright.ciConfig : {}),
    testDir: path.join(rootDir, config.testDirectory),
  }
  fs.writeFileSync(configPath, `export default ${JSON.stringify(options, null, 2)}\n`)
  return { path: configPath, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) }
}

export function assertPlaywrightBrowser(rootDir: string, config: E2eTestsConfig): void {
  let playwright: Record<string, unknown>
  try {
    playwright = createRequire(path.join(rootDir, 'package.json'))(config.playwrightPackage) as Record<string, unknown>
  } catch (error) {
    throw new Error(`Playwright package is unavailable: ${config.playwrightPackage}. ${(error as Error).message}`)
  }

  const browser = playwright[config.browser] as PlaywrightBrowser | undefined
  if (!browser || typeof browser.executablePath !== 'function') {
    throw new Error(`Playwright browser is unavailable: ${config.browser}.`)
  }

  const executablePath = browser.executablePath()
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Playwright browser is not installed: ${config.browser}. Run \`playwright install ${config.browser}\`.`)
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isReady(urlText: string): Promise<boolean> {
  const url = new URL(urlText)
  const client = url.protocol === 'https:' ? https : http
  return new Promise((resolve) => {
    const request = client.get(url, (response) => {
      response.resume()
      resolve(response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 400)
    })
    request.on('error', () => resolve(false))
    request.setTimeout(5000, () => {
      request.destroy()
      resolve(false)
    })
  })
}

function startServer(rootDir: string, config: E2eServerConfig): ManagedServer {
  const resolved = resolveSpawnSpec(config.command, config.args ?? [])
  const managed: ManagedServer = {
    config,
    child: spawn(resolved.command, resolved.args, {
      cwd: config.cwd ? path.join(rootDir, config.cwd) : rootDir,
      env: { ...process.env, FORCE_COLOR: '1', ...(config.env ?? {}) },
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
    output: '',
  }

  managed.child.stdout?.on('data', (chunk: Buffer) => {
    managed.output += chunk.toString()
  })
  managed.child.stderr?.on('data', (chunk: Buffer) => {
    managed.output += chunk.toString()
  })
  managed.child.on('error', (error) => {
    managed.error = error
  })
  return managed
}

function serverFailure(managed: ManagedServer): Error | null {
  if (managed.error) return new Error(`E2E server ${managed.config.name} could not start: ${managed.error.message}`)
  if (managed.child.exitCode !== null || managed.child.signalCode !== null) {
    const output = managed.output.trim()
    return new Error(`E2E server ${managed.config.name} stopped before readiness.${output ? `\n${output}` : ''}`)
  }
  return null
}

async function waitForServer(managed: ManagedServer): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < managed.config.timeoutMs) {
    const failure = serverFailure(managed)
    if (failure) throw failure
    if (await isReady(managed.config.readinessUrl)) return
    await wait(250)
  }
  throw new Error(`E2E server ${managed.config.name} did not become ready at ${managed.config.readinessUrl} within ${managed.config.timeoutMs}ms.`)
}

function runPlaywright(rootDir: string, config: E2eTestsConfig, configPath: string, rawArgs: string[]): Promise<number> {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  const resolved = resolveSpawnSpec(config.runner.command, [
    ...config.runner.args,
    '--config',
    configPath,
    ...args,
  ])
  const child = spawn(resolved.command, resolved.args, {
    cwd: rootDir,
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: false,
    stdio: 'inherit',
  })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

export async function runE2eTests(runtime: Runtime, rawArgs: string[]): Promise<void> {
  const config = getE2eConfig(runtime.config)
  assertE2eFiles(runtime.cwd, config)
  assertPlaywrightBrowser(runtime.cwd, config)
  const playwrightConfig = createPlaywrightConfig(runtime.cwd, config)

  console.info(`\nStarting Playwright E2E suite (${config.browser})...\n`)
  const servers = config.servers.map((server) => startServer(runtime.cwd, server))
  const cleanup = () => servers.forEach(({ child }) => stopChildProcessTree(child))
  process.once('SIGINT', cleanup)
  process.once('SIGTERM', cleanup)

  try {
    await Promise.all(servers.map(waitForServer))
    const code = await runPlaywright(runtime.cwd, config, playwrightConfig.path, rawArgs)
    if (code !== 0) throw new Error(`Playwright end-to-end tests failed with exit code ${code}.`)
  } finally {
    process.off('SIGINT', cleanup)
    process.off('SIGTERM', cleanup)
    cleanup()
    playwrightConfig.cleanup()
  }
}
