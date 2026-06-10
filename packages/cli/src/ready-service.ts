import http from 'node:http'
import https from 'node:https'

import type { WebToolkitCliConfig } from './config.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

type ReadinessResult = {
  success: boolean
  status?: string
  error?: string
  readinessData?: Record<string, unknown>
}

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

const defaultPollIntervalMs = 1000

function colorize(message: string, color: string): string {
  return `${color}${message}${colors.reset}`
}

function getArgValue(args: string[], name: string): string | null {
  const prefix = `--${name}=`
  const index = args.findIndex((arg) => arg === `--${name}`)
  if (index >= 0) return args[index + 1] ?? null
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

function parseTimeoutMs(rawValue: string | undefined | null): number | null {
  if (!rawValue) return null
  const normalized = rawValue.trim().toLowerCase()
  if (normalized === 'never' || normalized === '0') return null
  const value = Number(normalized)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid timeout: ${rawValue}. Use a non-negative integer in milliseconds, 0, or "never".`)
  }
  return value
}

function parseIntervalMs(rawValue: string | undefined | null): number {
  if (!rawValue) return defaultPollIntervalMs
  const value = Number(rawValue.trim())
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid interval: ${rawValue}. Use a positive integer in milliseconds.`)
  }
  return value
}

function validateUrl(urlString: string): URL {
  const url = new URL(urlString)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid protocol: ${url.protocol}. Only http: and https: are allowed.`)
  }
  return url
}

function getReadinessUrl(url: URL): string {
  return `${url.protocol}//${url.host}/ready`
}

function checkReadiness(url: URL): Promise<ReadinessResult> {
  return new Promise((resolve) => {
    const readinessUrl = getReadinessUrl(url)
    const httpModule = url.protocol === 'https:' ? https : http
    const req = httpModule.get(readinessUrl, (res) => {
      let data = ''

      res.on('data', (chunk: Buffer) => {
        data += chunk.toString()
      })

      res.on('end', () => {
        try {
          const readinessStatus = JSON.parse(data) as Record<string, unknown>
          if (res.statusCode === 200 && readinessStatus.status === 'ok') {
            resolve({ success: true, status: 'ok', readinessData: readinessStatus })
            return
          }
          resolve({
            success: false,
            status: String(readinessStatus.status ?? 'unknown'),
            readinessData: readinessStatus,
            error: `HTTP ${res.statusCode}: service status ${String(readinessStatus.status ?? 'unknown')}`,
          })
        } catch (error) {
          resolve({ success: false, error: `Invalid JSON response: ${(error as Error).message}` })
        }
      })
    })

    req.on('error', (error: NodeJS.ErrnoException) => {
      resolve({ success: false, error: `Network error: ${error.code || error.message}` })
    })

    req.setTimeout(5000, () => {
      req.destroy()
      resolve({ success: false, error: 'Request timeout (5s)' })
    })
  })
}

function formatSeconds(milliseconds: number): string {
  const seconds = milliseconds / 1000
  const formatted = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1).replace(/\.0$/u, '')
  return `${formatted} ${seconds === 1 ? 'second' : 'seconds'}`
}

function formatTimeout(timeoutMs: number | null): string {
  return timeoutMs === null ? 'no timeout' : `timeout: ${formatSeconds(timeoutMs)}`
}

async function pollService(url: URL, timeoutMs: number | null, intervalMs: number) {
  const startedAt = Date.now()
  let attempts = 0
  let lastResult: ReadinessResult | null = null

  while (timeoutMs === null || Date.now() - startedAt < timeoutMs) {
    attempts += 1
    const result = await checkReadiness(url)
    lastResult = result
    if (result.success) return { success: true, attempts, elapsedMs: Date.now() - startedAt, lastResult }

    const remainingMs = timeoutMs === null ? intervalMs : timeoutMs - (Date.now() - startedAt)
    if (remainingMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remainingMs)))
    }
  }

  return { success: false, attempts, elapsedMs: Date.now() - startedAt, lastResult }
}

export async function runReadyService(_runtime: Runtime, rawArgs: string[]): Promise<void> {
  if (rawArgs.includes('--skip-ready-check')) {
    console.info(colorize('Service readiness check skipped; continuing startup.', colors.yellow))
    return
  }

  const serviceName = getArgValue(rawArgs, 'name') || process.env.READY_SERVICE_NAME || 'Backend'
  const serviceUrl = getArgValue(rawArgs, 'url') || process.env.BACKEND_READY_URL || process.env.VITE_API_URL || 'http://localhost:3001'
  const timeoutMs = parseTimeoutMs(getArgValue(rawArgs, 'timeout-ms') ?? process.env.BACKEND_READY_TIMEOUT_MS)
  const intervalMs = parseIntervalMs(getArgValue(rawArgs, 'interval-ms') ?? process.env.BACKEND_READY_INTERVAL_MS)
  const url = validateUrl(serviceUrl)

  console.info(colorize(
    `Waiting for ${serviceName}: ${getReadinessUrl(url)} (interval: ${formatSeconds(intervalMs)}, ${formatTimeout(timeoutMs)})`,
    colors.cyan,
  ))

  const result = await pollService(url, timeoutMs, intervalMs)
  if (result.success) {
    console.info(colorize(`${serviceName} ready after ${formatSeconds(result.elapsedMs)}; continuing startup.`, colors.green))
    return
  }

  console.error(colorize(`\nService did not become available after ${result.attempts} attempts.`, colors.red))
  if (result.lastResult?.error) console.error(colorize(`   ${result.lastResult.error}`, colors.dim))
  process.exit(1)
}
