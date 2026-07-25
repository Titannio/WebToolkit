import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig } from './config.js'

type ServerMode = 'available' | 'listen-error-code' | 'listen-error-message' | 'listen-error-unknown' | 'close-error'

function createFakeServer(mode: ServerMode) {
  const server = new EventEmitter() as EventEmitter & {
    unref: ReturnType<typeof vi.fn>
    listen: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
  server.unref = vi.fn()
  server.listen = vi.fn((_options, callback) => {
    if (mode.startsWith('listen-error')) {
      const error = mode === 'listen-error-code'
        ? Object.assign(new Error('blocked'), { code: 'EADDRINUSE' })
        : mode === 'listen-error-message' ? new Error('blocked') : {}
      queueMicrotask(() => server.emit('error', error))
    } else {
      queueMicrotask(callback)
    }
    return server
  })
  server.close = vi.fn((callback) => {
    queueMicrotask(() => callback(mode === 'close-error' ? new Error('close failed') : undefined))
    return server
  })
  return server
}

function createFakeChild(pid = 123) {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    pid?: number
    kill: ReturnType<typeof vi.fn>
  }
  child.exitCode = null
  child.signalCode = null
  child.pid = pid
  child.kill = vi.fn()
  return child
}

async function loadRuntime(platform: NodeJS.Platform, options: {
  serverModes?: ServerMode[]
  spawnResults?: unknown[]
} = {}) {
  vi.resetModules()
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  const modes = [...(options.serverModes ?? ['available'])]
  const createServer = vi.fn(() => createFakeServer(modes.shift() ?? 'available'))
  const spawn = vi.fn(() => createFakeChild() as never)
  const results = [...(options.spawnResults ?? [])]
  const spawnSync = vi.fn(() => (results.shift() ?? { status: 0, stdout: '' }) as never)
  vi.doMock('node:net', () => ({ createServer }))
  vi.doMock('node:child_process', () => ({ spawn, spawnSync }))
  const module = await import('./dev-watch.js')
  return { module, createServer, spawn, spawnSync }
}

function runtime(overrides: Parameters<typeof mergeConfig>[0] = {}) {
  return {
    cwd: '/repo',
    config: mergeConfig({
      packageManager: 'pnpm',
      devWatch: {
        backendApp: 'backend',
        backendPortCleanupGraceMs: 0,
        defaultApps: ['app'],
        apps: {
          app: { displayName: 'App', filter: '@acme/app', port: 3001 },
          backend: { displayName: 'Backend', filter: '@acme/backend', port: 3000 },
          nofilter: { displayName: 'No filter', port: 3002 },
        },
      },
      ...overrides,
    }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('node:net')
  vi.doUnmock('node:child_process')
  process.exitCode = undefined
})

describe('dev-watch runtime', () => {
  it('parses only matching Windows LISTENING endpoints and deduplicates PIDs', async () => {
    const { module } = await loadRuntime('win32')
    expect(module.parseWindowsNetstatListeningPids([
      'TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 20',
      'TCP [::1]:3000 [::]:0 LISTENING 10',
      'TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 20',
      'TCP 127.0.0.1:3001 0.0.0.0:0 LISTENING 30',
      'TCP invalid 0.0.0.0:0 ESTABLISHED nope',
      'TCP invalid 0.0.0.0:0 LISTENING 50',
      'TCP 127.0.0.1:not-a-port 0.0.0.0:0 LISTENING 60',
      'UDP 127.0.0.1:3000 *:* 40',
      'short',
    ].join('\n'), 3000)).toEqual([10, 20])
    expect(module.parseWindowsNetstatListeningPids(undefined as never, 3000)).toEqual([])
  })

  it('validates required configuration and selected app names', async () => {
    const { module } = await loadRuntime('linux')
    await expect(module.runDevWatch({ cwd: '/repo', config: mergeConfig() }, [])).rejects.toThrow('not configured')
    await expect(module.runDevWatch(runtime(), ['--apps=app, missing, ,other'])).rejects.toThrow('missing, other')
  })

  it('checks default and explicit apps without starting watchers', async () => {
    const { module, createServer, spawn } = await loadRuntime('linux', { serverModes: ['available', 'available'] })
    await module.runDevWatch(runtime(), ['--check-only'])
    await module.runDevWatch(runtime(), ['--check-only', '--apps=app'])
    expect(createServer).toHaveBeenCalledTimes(2)
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each([
    ['listen-error-code' as ServerMode, 'EADDRINUSE'],
    ['listen-error-message' as ServerMode, 'blocked'],
    ['listen-error-unknown' as ServerMode, 'unknown error'],
    ['close-error' as ServerMode, 'close failed'],
  ])('reports unavailable ports from %s', async (mode, reason) => {
    const { module } = await loadRuntime('linux', { serverModes: [mode] })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    await module.runDevWatch(runtime(), ['--check-only'])
    expect(error.mock.calls.flat().join('\n')).toContain(reason)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('cleans an existing Windows backend listener before checking ports', async () => {
    const netstat = 'TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 42'
    const { module, spawnSync } = await loadRuntime('win32', {
      serverModes: ['available', 'available'],
      spawnResults: [
        { status: 0, stdout: netstat },
        { status: 0 },
        { status: 0, stdout: '' },
      ],
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await module.runDevWatch(runtime(), ['--check-only', '--include-backend'])
    expect(spawnSync).toHaveBeenCalledWith('taskkill.exe', ['/pid', '42', '/t', '/f'], expect.any(Object))
  })

  it('uses default backend name and cleanup grace', async () => {
    vi.useFakeTimers()
    const { module } = await loadRuntime('win32', {
      serverModes: ['available', 'available'],
      spawnResults: [{ status: 0, stdout: '' }],
    })
    const config = mergeConfig({
      devWatch: {
        defaultApps: ['app'],
        apps: {
          app: { displayName: 'App', filter: 'app', port: 3001 },
          backend: { displayName: 'Backend', filter: 'backend', port: 3000 },
        },
      },
    })
    const promise = module.runDevWatch({ cwd: '/repo', config }, ['--check-only', '--include-backend'])
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it('falls back between Windows netstat commands and rejects remaining listeners', async () => {
    const netstat = 'TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 42'
    const { module } = await loadRuntime('win32', {
      spawnResults: [
        { status: 1, error: new Error('missing') },
        { status: 0, stdout: netstat },
        { status: 1, error: new Error('kill failed') },
        { status: 0, stdout: netstat },
      ],
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(module.runDevWatch(runtime(), ['--check-only', '--include-backend'])).rejects.toThrow('PID 42')
  })

  it('returns when Windows listener discovery fails', async () => {
    const { module } = await loadRuntime('win32', {
      serverModes: ['available', 'available'],
      spawnResults: [{ status: 1 }, { status: 1 }],
    })
    await expect(module.runDevWatch(runtime(), ['--check-only', '--include-backend'])).resolves.toBeUndefined()
  })

  it('handles Linux lsof discovery and already-gone processes', async () => {
    const { module } = await loadRuntime('linux', {
      serverModes: ['available', 'available'],
      spawnResults: [
        { status: 0, stdout: '42\ninvalid\n' },
        { status: 0, stdout: '' },
      ],
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    await expect(module.runDevWatch(runtime(), ['--check-only', '--include-backend'])).resolves.toBeUndefined()
  })

  it('handles Linux listener discovery and termination failures', async () => {
    const { module } = await loadRuntime('linux', {
      spawnResults: [
        { status: 0, stdout: '42\n' },
        { status: 0, stdout: '42\n' },
      ],
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' })
    })
    await expect(module.runDevWatch(runtime(), ['--check-only', '--include-backend'])).rejects.toThrow('PID 42')
  })

  it.each([
    { error: new Error('missing'), status: 1 },
    { status: 1, stdout: '' },
  ])('ignores failed Linux lsof results: %j', async (result) => {
    const { module } = await loadRuntime('linux', {
      serverModes: ['available', 'available'],
      spawnResults: [result],
    })
    await expect(module.runDevWatch(runtime(), ['--check-only', '--include-backend'])).resolves.toBeUndefined()
  })

  it('starts colored watchers with silent arguments and handles child errors once', async () => {
    const { module, spawn } = await loadRuntime('linux')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await module.runDevWatch(runtime(), ['--silent'])
    const child = vi.mocked(spawn).mock.results[0].value as ReturnType<typeof createFakeChild>
    expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['--', '--logLevel', 'warn']), expect.objectContaining({
      detached: true,
      env: expect.objectContaining({ FORCE_COLOR: '1' }),
    }))
    child.emit('error', new Error('watch failed'))
    child.emit('exit', 2, null)
    expect(error.mock.calls.flat().join('\n')).toContain('watch failed')
    expect(process.exitCode).toBe(1)
  })

  it('handles successful, failing, and signalled child exits', async () => {
    const cases: Array<[number | null, NodeJS.Signals | null, number]> = [
      [0, null, 0],
      [null, null, 0],
      [2, null, 2],
      [null, 'SIGTERM', 1],
    ]
    for (const [code, signal, exitCode] of cases) {
      const { module, spawn } = await loadRuntime('linux')
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      await module.runDevWatch(runtime(), [])
      const child = vi.mocked(spawn).mock.results[0].value as ReturnType<typeof createFakeChild>
      child.emit('exit', code, signal)
      expect(process.exitCode).toBe(exitCode)
      process.exitCode = undefined
    }
  })

  it('requires a watcher filter', async () => {
    const { module } = await loadRuntime('linux')
    await expect(module.runDevWatch(runtime(), ['--apps=nofilter'])).rejects.toThrow('must define filter')
  })

  it('shuts down Windows child trees from process signals', async () => {
    const handlers = new Map<string, () => void>()
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => void) => {
      handlers.set(event, handler)
      return process
    }) as never)
    const { module, spawn } = await loadRuntime('win32')
    await module.runDevWatch(runtime(), [])
    handlers.get('SIGINT')?.()
    handlers.get('SIGTERM')?.()
    expect(spawn).toHaveBeenCalledWith('taskkill', ['/pid', '123', '/t', '/f'], expect.any(Object))
    expect(process.exitCode).toBe(130)
  })

  it('does not stop an already exited child', async () => {
    const handlers = new Map<string, () => void>()
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => void) => {
      handlers.set(event, handler)
      return process
    }) as never)
    const { module, spawn } = await loadRuntime('linux')
    const kill = vi.spyOn(process, 'kill')
    await module.runDevWatch(runtime(), [])
    const child = vi.mocked(spawn).mock.results[0].value as ReturnType<typeof createFakeChild>
    child.exitCode = 0
    handlers.get('SIGINT')?.()
    expect(kill).not.toHaveBeenCalled()
  })

  it('falls back to child.kill when Linux group termination fails', async () => {
    const handlers = new Map<string, () => void>()
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => void) => {
      handlers.set(event, handler)
      return process
    }) as never)
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('kill failed')
    })
    const { module, spawn } = await loadRuntime('linux')
    await module.runDevWatch(runtime(), [])
    const child = vi.mocked(spawn).mock.results[0].value as ReturnType<typeof createFakeChild>
    handlers.get('SIGTERM')?.()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(process.exitCode).toBe(143)
  })
})
