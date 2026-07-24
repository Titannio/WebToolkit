/**
 * @module server.http.types
 * @description Server-side HTTP request metadata types.
 */

/**
 * Minimal representation of HTTP request headers for extraction purposes.
 */
export interface HttpRequestHeaders {
  [key: string]: string | string[] | undefined
  'cf-connecting-ip'?: string | string[]
  'x-forwarded-for'?: string | string[]
  'x-real-ip'?: string | string[]
  'user-agent'?: string
  referer?: string
  referrer?: string
}

/**
 * Minimal representation of an HTTP request for metadata extraction.
 */
export interface HttpRequest {
  headers?: HttpRequestHeaders
  socket?: {
    remoteAddress?: string
  }
  connection?: {
    remoteAddress?: string
  }
}

/**
 * Extracted client network metadata from an HTTP request.
 */
export interface ClientNetworkData {
  ipAddress: string
  userAgent: string
  referer: string | null
}

/**
 * Type-only marker used to keep this module in runtime export maps.
 */
export const __serverHttpTypes = true as const
