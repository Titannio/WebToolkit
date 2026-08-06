import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createRequire: vi.fn(),
  get: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('node:module', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:module')>(),
  createRequire: mocks.createRequire,
}))
vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return { ...actual, default: { ...actual, get: mocks.get }, get: mocks.get }
})
vi.mock('node:https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:https')>()
  return { ...actual, default: { ...actual, get: mocks.get }, get: mocks.get }
})
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: mocks.spawn,
}))

import { assertE2eFiles, assertPlaywrightBrowser, countE2eTestFiles, createPlaywrightConfig, getE2eConfig, runE2eTests } from './e2e-tests.js'
import { mergeConfig } from './config.js'

type FakeChild = EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  pid: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill: ReturnType<typeof vi.fn>
}

const temporaryDirectories: string[] = []

function config() {
  return mergeConfig({
    e2eTests: {
      playwrightPackage: '@playwright/test',
      testDirectory: 'tests/e2e',
      browser: 'chromium',
      playwright: { config: { testMatch: '**/*.spec.ts', reporter: 'list' }, ciConfig: { reporter: 'github' } },
      runner: { command: 'node', args: ['playwright'] },
      servers: [{ name: 'App', command: 'node', args: ['server'], readinessUrl: 'http://localhost:3000', timeoutMs: 100 }],
    },
  })
}

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'webtoolkit-e2e-tests-'))
  temporaryDirectories.push(directory)
  await mkdir(path.join(directory, 'tests', 'e2e', 'nested'), { recursive: true })
  await writeFile(path.join(directory, 'tests', 'e2e', 'example.spec.ts'), 'export {}\n')
  await writeFile(path.join(directory, 'tests', 'e2e', 'nested', 'ignored.test.ts'), 'export {}\n')
  return directory
}

function child(exitCode: number | null = null): FakeChild {
  const result = new EventEmitter() as FakeChild
  result.stdout = new PassThrough()
  result.stderr = new PassThrough()
  result.pid = 123
  result.exitCode = exitCode
  result.signalCode = null
  result.kill = vi.fn()
  return result
}

beforeEach(() => {
  mocks.createRequire.mockReturnValue(() => ({ chromium: { executablePath: () => process.execPath } }))
  mocks.get.mockImplementation((_url: URL, callback: (response: { statusCode: number, resume(): void }) => void) => {
    callback({ statusCode: 200, resume: vi.fn() })
    return { on: vi.fn(), setTimeout: vi.fn() }
  })
  mocks.spawn.mockImplementation((_command: string, args: string[]) => {
    const result = child()
    if (args.includes('playwright')) setTimeout(() => result.emit('close', 0), 0)
    return result
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  mocks.createRequire.mockReset()
  mocks.get.mockReset()
  mocks.spawn.mockReset()
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Playwright E2E tests', () => {
  it('requires configured E2E settings', () => {
    expect(() => getE2eConfig(mergeConfig())).toThrow('e2eTests is not configured')
  })

  it('counts configured Playwright specs while skipping generated directories', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'tests', 'e2e', 'dist'), { recursive: true })
    await writeFile(path.join(directory, 'tests', 'e2e', 'dist', 'generated.spec.ts'), 'export {}\n')
    expect(countE2eTestFiles(path.join(directory, 'tests', 'e2e'), /\.spec\.ts$/u)).toBe(1)
    expect(countE2eTestFiles(path.join(directory, 'missing'), /\.spec\.ts$/u)).toBe(0)
  })

  it('rejects missing test directories and matching specs', async () => {
    const directory = await root()
    const e2e = getE2eConfig(config())
    await rm(path.join(directory, 'tests'), { recursive: true })
    expect(() => assertE2eFiles(directory, e2e)).toThrow('test directory is missing')
    await mkdir(path.join(directory, 'tests', 'e2e'), { recursive: true })
    expect(() => assertE2eFiles(directory, e2e)).toThrow('No Playwright tests match')
  })

  it('generates and removes a Playwright config from JSON options', async () => {
    const directory = await root()
    const previousCi = process.env.CI
    try {
      delete process.env.CI
      const generated = createPlaywrightConfig(directory, getE2eConfig(config()))
      await expect(readFile(generated.path, 'utf8')).resolves.toContain('"reporter": "list"')
      await expect(readFile(generated.path, 'utf8')).resolves.toContain('"testDir": "')
      generated.cleanup()
      await expect(readFile(generated.path, 'utf8')).rejects.toThrow()

      process.env.CI = '1'
      const ciGenerated = createPlaywrightConfig(directory, getE2eConfig(config()))
      await expect(readFile(ciGenerated.path, 'utf8')).resolves.toContain('"reporter": "github"')
      ciGenerated.cleanup()
    } finally {
      if (previousCi === undefined) delete process.env.CI
      else process.env.CI = previousCi
    }
  })

  it('reports unavailable Playwright packages and browsers', async () => {
    const directory = await root()
    const e2e = getE2eConfig(config())
    mocks.createRequire.mockReturnValueOnce(() => { throw new Error('missing package') })
    expect(() => assertPlaywrightBrowser(directory, e2e)).toThrow('Playwright package is unavailable')
    mocks.createRequire.mockReturnValueOnce(() => ({}))
    expect(() => assertPlaywrightBrowser(directory, e2e)).toThrow('Playwright browser is unavailable')
    mocks.createRequire.mockReturnValueOnce(() => ({ chromium: { executablePath: () => path.join(directory, 'missing-browser') } }))
    expect(() => assertPlaywrightBrowser(directory, e2e)).toThrow('Playwright browser is not installed')
  })

  it('starts ready servers, forwards Playwright arguments, and cleans up', async () => {
    const directory = await root()
    await runE2eTests({ cwd: directory, config: config() }, ['--', 'tests/e2e/example.spec.ts', '--grep', 'example'])
    const runnerCall = mocks.spawn.mock.calls.find((call) => (call[1] as string[]).includes('playwright'))
    expect(runnerCall?.[1]).toEqual(expect.arrayContaining(['playwright', '--config', 'tests/e2e/example.spec.ts', '--grep', 'example']))
    expect(mocks.get).toHaveBeenCalledWith(new URL('http://localhost:3000'), expect.any(Function))
  })

  it('fails when the runner exits unsuccessfully', async () => {
    const directory = await root()
    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const result = child()
      if (args.includes('playwright')) setTimeout(() => result.emit('close', 2), 0)
      return result
    })
    await expect(runE2eTests({ cwd: directory, config: config() }, [])).rejects.toThrow('exit code 2')
  })

  it('treats a runner with no exit code as a failure', async () => {
    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const result = child()
      if (args.includes('playwright')) setTimeout(() => result.emit('close', null), 0)
      return result
    })

    const directory = await root()
    await expect(runE2eTests({ cwd: directory, config: config() }, [])).rejects.toThrow('exit code 1')
  })

  it('fails when a server stops before readiness', async () => {
    const directory = await root()
    mocks.get.mockImplementation((_url: URL, callback: (response: { statusCode: number, resume(): void }) => void) => {
      callback({ statusCode: 503, resume: vi.fn() })
      return { on: vi.fn(), setTimeout: vi.fn() }
    })
    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const result = child(args.includes('server') ? 1 : null)
      return result
    })
    await expect(runE2eTests({ cwd: directory, config: config() }, [])).rejects.toThrow('stopped before readiness')
  })

  it('reports server startup errors and captured output', async () => {
    const directory = await root()
    mocks.get.mockImplementation((_url: URL, callback: (response: { statusCode: number, resume(): void }) => void) => {
      callback({ statusCode: 503, resume: vi.fn() })
      return { on: vi.fn(), setTimeout: vi.fn() }
    })
    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const result = child()
      if (args.includes('server')) {
        queueMicrotask(() => {
          result.stdout.write('server stdout')
          result.stderr.write('server stderr')
          result.emit('error', new Error('startup failed'))
        })
      }
      return result
    })
    const startupConfig = config()
    startupConfig.e2eTests!.servers[0].timeoutMs = 1000
    await expect(runE2eTests({ cwd: directory, config: startupConfig }, [])).rejects.toThrow('could not start: startup failed')
  })

  it('reports server exit output and readiness timeouts', async () => {
    const directory = await root()
    mocks.get.mockImplementation((_url: URL, callback: (response: { statusCode: number, resume(): void }) => void) => {
      callback({ statusCode: 503, resume: vi.fn() })
      return { on: vi.fn(), setTimeout: vi.fn() }
    })
    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const result = child()
      if (args.includes('server')) {
        queueMicrotask(() => {
          result.stdout.write('server output')
          result.exitCode = 1
        })
      }
      return result
    })
    const stoppedConfig = config()
    stoppedConfig.e2eTests!.servers[0].timeoutMs = 1000
    await expect(runE2eTests({ cwd: directory, config: stoppedConfig }, [])).rejects.toThrow('server output')

    const timeoutConfig = config()
    timeoutConfig.e2eTests!.servers[0].timeoutMs = 1
    mocks.spawn.mockImplementation(() => child())
    await expect(runE2eTests({ cwd: directory, config: timeoutConfig }, [])).rejects.toThrow('did not become ready')
  })

  it('fails when the Playwright runner cannot start', async () => {
    const directory = await root()
    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const result = child()
      if (args.includes('playwright')) queueMicrotask(() => result.emit('error', new Error('runner unavailable')))
      return result
    })
    await expect(runE2eTests({ cwd: directory, config: config() }, [])).rejects.toThrow('runner unavailable')
  })

  it('handles readiness request errors and timeouts', async () => {
    const directory = await root()
    const timeoutConfig = config()
    const timeoutServer = timeoutConfig.e2eTests!.servers[0]
    timeoutServer.args = undefined
    timeoutServer.cwd = 'apps/web'
    timeoutServer.env = { CUSTOM: 'yes' }
    timeoutServer.readinessUrl = 'https://localhost:3000'
    timeoutServer.timeoutMs = 100
    const destroy = vi.fn()
    mocks.get.mockImplementation(() => ({
      on: vi.fn(),
      setTimeout: vi.fn((_timeout: number, callback: () => void) => callback()),
      destroy,
    }))
    await expect(runE2eTests({ cwd: directory, config: timeoutConfig }, [])).rejects.toThrow('did not become ready')
    expect(destroy).toHaveBeenCalled()
    expect(mocks.spawn.mock.calls.find((call) => (call[1] as string[]).length === 0)?.[2]).toEqual(expect.objectContaining({
      cwd: path.join(directory, 'apps/web'),
      env: expect.objectContaining({ CUSTOM: 'yes' }),
    }))

    const errorConfig = config()
    errorConfig.e2eTests!.servers[0].timeoutMs = 100
    mocks.get.mockImplementation(() => {
      const request = {
        on: vi.fn((event: string, callback: () => void) => {
          if (event === 'error') callback()
          return request
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      }
      return request
    })
    await expect(runE2eTests({ cwd: directory, config: errorConfig }, [])).rejects.toThrow('did not become ready')
  })
})
