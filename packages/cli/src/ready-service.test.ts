import type { ClientRequest, IncomingMessage } from 'node:http'
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { mergeConfig } from './config.js'

type HttpGet = (url: string | URL, onConnected: (response: IncomingMessage) => void) => ClientRequest
let mockedHttpGet: HttpGet | null = null
let mockedHttpsGet: HttpGet | null = null

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  const actualGet = actual.get as HttpGet
  const mockAwareGet = (...args: Parameters<HttpGet>) => (
    mockedHttpGet ?? actualGet)(...args)

  return {
    ...actual,
    default: {
      ...(actual as { default?: Record<string, unknown> }).default,
      get: mockAwareGet,
    },
    get: mockAwareGet,
  }
})

vi.mock('node:https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:https')>()
  const actualGet = actual.get as HttpGet
  const mockAwareGet = (...args: Parameters<HttpGet>) => (
    mockedHttpsGet ?? actualGet)(...args)

  return {
    ...actual,
    default: {
      ...(actual as { default?: Record<string, unknown> }).default,
      get: mockAwareGet,
    },
    get: mockAwareGet,
  }
})

import { runReadyService } from './ready-service.js'

const runtimeWithConfig = (cwd: string, config: Parameters<typeof mergeConfig>[0] = {}) => ({ cwd, config: mergeConfig(config) })

function buildReadyServer(statusCode: number, body: string, delay = 0) {
  return createServer((request, response) => {
    if (request.url === '/ready') {
      setTimeout(() => {
        response.statusCode = statusCode
        response.end(body)
      }, delay)
      return
    }
    response.statusCode = 404
    response.end('not found')
  })
}

describe('ready service waiting', () => {
  it('skips readiness checks when skip flag is set', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await runReadyService(runtimeWithConfig('/repo'), ['--skip-ready-check'])

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Service readiness check skipped; continuing startup.'))
    consoleInfo.mockRestore()
  })

  it('succeeds when /ready reports ok', async () => {
    const server = buildReadyServer(200, '{"status":"ok"}')
    const port = 41231 + Math.floor(Math.random() * 100)
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))

    try {
      const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', `http://127.0.0.1:${port}`, '--name', 'Backend', '--timeout-ms=1'],
      )

      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Backend ready'))
      consoleInfo.mockRestore()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('accepts "never" timeout and exits successfully when service is ready', async () => {
    const server = buildReadyServer(200, '{"status":"ok"}')
    const port = 41431 + Math.floor(Math.random() * 100)
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))

    try {
      const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', `http://127.0.0.1:${port}`, '--timeout-ms=never'],
      )

      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Backend ready'))
      consoleInfo.mockRestore()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('throws on interval less than one millisecond', async () => {
    await expect(runReadyService(
      runtimeWithConfig('/repo'),
      ['--interval-ms=0'],
    )).rejects.toThrow('Invalid interval')
  })

  it('throws on unsupported readiness URL protocols', async () => {
    await expect(runReadyService(
      runtimeWithConfig('/repo'),
      ['--url', 'ftp://127.0.0.1:21'],
    )).rejects.toThrow('Invalid protocol')
  })

  it('fails when /ready endpoint returns invalid JSON', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/ready') {
        response.statusCode = 200
        response.end('not-json')
        return
      }
      response.statusCode = 404
      response.end('not found')
    })
    const port = 41531 + Math.floor(Math.random() * 100)
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    try {
      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', `http://127.0.0.1:${port}`, '--timeout-ms=1', '--interval-ms=1'],
      )

      expect(processExit).toHaveBeenCalledWith(1)
    } finally {
      processExit.mockRestore()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('fails when the service is unreachable', async () => {
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await runReadyService(
        runtimeWithConfig('/repo'),
      ['--url', 'http://127.0.0.1:9', '--timeout-ms=1', '--interval-ms=1'],
    )

    expect(processExit).toHaveBeenCalledWith(1)
    processExit.mockRestore()
  })

  it('fails when timeout is reached before ready state', async () => {
    const server = buildReadyServer(503, '{"status":"starting"}', 10)
    const port = 41331 + Math.floor(Math.random() * 100)
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    try {

      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', `http://127.0.0.1:${port}`, '--name', 'Backend', '--timeout-ms=1', '--interval-ms=1'],
      )

      expect(processExit).toHaveBeenCalledWith(1)
    } finally {
      processExit.mockRestore()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('throws with invalid timeout option', async () => {
    await expect(() => runReadyService(runtimeWithConfig('/repo'), ['--timeout-ms=abc'])).rejects.toThrow('Invalid timeout')
  })

  it('supports inline "=" style arguments', async () => {
    const server = buildReadyServer(200, '{"status":"ok"}')
    const port = 41031 + Math.floor(Math.random() * 100)
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))

    try {
      const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

      await runReadyService(
        runtimeWithConfig('/repo'),
        [`--url=http://127.0.0.1:${port}`, '--name=Service', '--timeout-ms=never', '--interval-ms=10'],
      )

      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Service: http://127.0.0.1'))
      consoleInfo.mockRestore()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('retries until service reports ready', async () => {
    let hits = 0
    const server = createServer((request, response) => {
      if (request.url === '/ready') {
        hits += 1
        if (hits === 1) {
          response.statusCode = 503
          response.end('{"status":"starting"}')
          return
        }
        response.statusCode = 200
        response.end('{"status":"ok"}')
        return
      }
      response.statusCode = 404
      response.end('not found')
    })
    const port = 41631 + Math.floor(Math.random() * 100)
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))

    try {
      const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
      const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', `http://127.0.0.1:${port}`, '--timeout-ms=50', '--interval-ms=1'],
      )

      expect(hits).toBe(2)
      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('ready after'))
      expect(processExit).not.toHaveBeenCalled()
      consoleInfo.mockRestore()
      processExit.mockRestore()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('uses the infinite timeout branch when no timeout is configured', async () => {
    let hits = 0
    const server = createServer((request, response) => {
      if (request.url === '/ready') {
        hits += 1
        if (hits === 1) {
          response.statusCode = 503
          response.end('{"status":"starting"}')
          return
        }
        response.statusCode = 200
        response.end('{"status":"ok"}')
        return
      }
      response.statusCode = 404
      response.end('not found')
    })
    const port = 41811 + Math.floor(Math.random() * 100)
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))

    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    try {
      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', `http://127.0.0.1:${port}`, '--interval-ms=1'],
      )

      expect(processExit).not.toHaveBeenCalled()
      expect(hits).toBe(2)
      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Backend ready'))
    } finally {
      processExit.mockRestore()
      consoleInfo.mockRestore()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('logs the readiness error before exiting', async () => {
    const server = buildReadyServer(503, '{"status":"starting"}')
    const port = 41131 + Math.floor(Math.random() * 100)
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    try {
      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', `http://127.0.0.1:${port}`, '--timeout-ms=1', '--interval-ms=1'],
      )

      expect(processExit).toHaveBeenCalledWith(1)
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Service did not become available'))
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('HTTP'))
    } finally {
      processExit.mockRestore()
      consoleError.mockRestore()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('handles request timeout and logs the timeout reason', async () => {
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
    mockedHttpGet = (_url, onConnected) => {
        const response = { on: vi.fn() }
        const request: ClientRequest = {
          on: vi.fn(() => request),
          setTimeout: vi.fn((_: number, timeoutHandler: () => void) => {
            timeoutHandler()
            return request
          }),
          destroy: vi.fn(),
        } as unknown as ClientRequest
        onConnected(response as unknown as IncomingMessage)
        return request
      }

      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', 'http://example.com', '--timeout-ms=1', '--interval-ms=1'],
      )

      expect(processExit).toHaveBeenCalledWith(1)
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Request timeout (5s)'))
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Service did not become available'))
    } finally {
      mockedHttpGet = null
      consoleError.mockRestore()
      processExit.mockRestore()
    }
  })

  it('selects https module when URL uses https protocol', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    let usedHttps = false
    const mockedError: Error & { code?: string } = new Error('unexpected http usage')

    mockedHttpGet = () => {
      throw mockedError
    }

    mockedHttpsGet = (_url, onConnected) => {
      usedHttps = true
      const response = {
        statusCode: 200,
        on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
          if (event === 'data') handler(Buffer.from('{"status":"ok"}'))
          if (event === 'end') handler(Buffer.from(''))
          return response
        }),
      } as unknown as IncomingMessage

      const request: ClientRequest = {
        on: vi.fn(() => request),
        setTimeout: vi.fn(),
      } as unknown as ClientRequest

      onConnected(response)
      return request
    }

    try {
      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', 'https://api.example.com', '--timeout-ms=1'],
      )

      expect(usedHttps).toBe(true)
      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Backend ready'))
    } finally {
      mockedHttpGet = null
      mockedHttpsGet = null
      consoleInfo.mockRestore()
    }
  })

  it('covers default timeout and interval defaults when not explicitly configured', async () => {
    const server = buildReadyServer(200, '{"status":"ok"}')
    const port = 41731 + Math.floor(Math.random() * 100)
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))

    try {
      const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', `http://127.0.0.1:${port}`],
      )

      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('no timeout'))
      consoleInfo.mockRestore()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('treats timeout arg without value as default (infinite) timeout', async () => {
    const server = buildReadyServer(200, '{"status":"ok"}')
    const port = 41781 + Math.floor(Math.random() * 100)
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))

    try {
      const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', `http://127.0.0.1:${port}`, '--timeout-ms'],
      )

      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('no timeout'))
      consoleInfo.mockRestore()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('falls back to unknown status when status field is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    mockedHttpGet = (_url, onConnected) => {
      const response = {
        statusCode: 503,
        on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
          if (event === 'data') handler(Buffer.from('{}'))
          if (event === 'end') handler(Buffer.from(''))
          return response
        }),
      } as unknown as IncomingMessage

      const request: ClientRequest = {
        on: vi.fn(() => request),
        setTimeout: vi.fn(),
      } as unknown as ClientRequest

      onConnected(response)
      return request
    }

    try {
      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', 'http://example.com', '--timeout-ms=1', '--interval-ms=1'],
      )

      expect(processExit).toHaveBeenCalledWith(1)
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('service status unknown'))
    } finally {
      mockedHttpGet = null
      processExit.mockRestore()
      consoleError.mockRestore()
    }
  })

  it('uses network error message when code is not present', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    mockedHttpGet = (_url, _onConnected) => {
      const request: ClientRequest = {
        on: vi.fn((event: string, handler: (error: { message: string }) => void) => {
          if (event === 'error') {
            handler({ message: 'connection failed' })
          }
          return request
        }),
        setTimeout: vi.fn(),
      } as unknown as ClientRequest
      return request
    }

    try {
      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', 'http://example.com', '--timeout-ms=1', '--interval-ms=1'],
      )

      expect(processExit).toHaveBeenCalledWith(1)
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Network error: connection failed'))
    } finally {
      mockedHttpGet = null
      processExit.mockRestore()
      consoleError.mockRestore()
    }
  })

  it('does not log a detailed error when no lastResult is available', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const processExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    let nowCalls = 0
    const now = vi.spyOn(Date, 'now').mockImplementation(() => {
      nowCalls += 1
      return 2000 + nowCalls
    })

    try {
      await runReadyService(
        runtimeWithConfig('/repo'),
        ['--url', 'http://example.com', '--timeout-ms=1', '--interval-ms=1'],
      )

      expect(processExit).toHaveBeenCalledWith(1)
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Service did not become available'))
      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Network error:'))
      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('HTTP '))
      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Request timeout (5s)'))
    } finally {
      now.mockRestore()
      processExit.mockRestore()
      consoleError.mockRestore()
    }
  })
})



