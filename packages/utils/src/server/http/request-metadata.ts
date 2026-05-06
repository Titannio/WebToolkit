/**
 * @module server.request-metadata
 * @description Server-side HTTP request metadata extraction helpers.
 */

import type { ClientNetworkData, HttpRequest } from './types.js'

/**
 * Extracts the best-effort client IP from a server request.
 *
 * @param {HttpRequest | null | undefined} req - Request candidate.
 * @returns {string} IP address, or an empty string when unavailable.
 */
export function extractIpAddress(req: HttpRequest | null | undefined): string {
  if (!req) return ''

  if (req.headers?.['cf-connecting-ip']) {
    return Array.isArray(req.headers['cf-connecting-ip'])
      ? req.headers['cf-connecting-ip'][0] ?? ''
      : req.headers['cf-connecting-ip']
  }

  if (req.headers?.['x-forwarded-for']) {
    const forwarded = Array.isArray(req.headers['x-forwarded-for'])
      ? req.headers['x-forwarded-for'][0]
      : req.headers['x-forwarded-for']

    if (forwarded) {
      return forwarded.split(',')[0]?.trim() ?? ''
    }
  }

  if (req.headers?.['x-real-ip']) {
    return Array.isArray(req.headers['x-real-ip'])
      ? req.headers['x-real-ip'][0] ?? ''
      : req.headers['x-real-ip']
  }

  if (req.socket?.remoteAddress) return req.socket.remoteAddress
  if (req.connection?.remoteAddress) return req.connection.remoteAddress

  return ''
}

/**
 * Extracts normalized client metadata from a server request.
 *
 * @param {HttpRequest | null | undefined} req - Request candidate.
 * @returns {ClientNetworkData} Extracted metadata.
 */
export function extractClientNetworkData(req: HttpRequest | null | undefined): ClientNetworkData {
  const userAgentHeader = req?.headers?.['user-agent']
  const refererHeader = req?.headers?.referer ?? req?.headers?.referrer ?? null

  return {
    ipAddress: extractIpAddress(req) || 'unknown',
    userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : 'unknown',
    referer: typeof refererHeader === 'string' ? refererHeader : null,
  }
}

/**
 * Returns secure cookie options derived from a deployment environment label.
 *
 * @param {string} env - Environment label.
 * @returns {{ httpOnly: true; secure: boolean; sameSite: 'strict' | 'lax'; path: '/' }} Cookie options.
 */
export function getSecurityCookieOptions(env: string) {
  const isProd = env === 'production'

  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' as const : 'lax' as const,
    path: '/',
  }
}
