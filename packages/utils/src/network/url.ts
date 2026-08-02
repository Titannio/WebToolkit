/**
 * @module url.utils
 * @description URL formatting helpers.
 */

export interface EnsureUrlProtocolOptions {
  /** Protocol to prepend when the URL has no explicit protocol. */
  defaultProtocol?: 'http' | 'https'
}

/** A query value accepted by {@link buildUrl}. */
export type UrlQueryValue = string | number | boolean | null | undefined

/**
 * Ensures a URL has an explicit HTTP or HTTPS protocol.
 *
 * @param {string} url - Input URL.
 * @param {EnsureUrlProtocolOptions} [options={}] - Formatting options.
 * @returns {string} URL with an explicit protocol when input is non-empty.
 */
export function ensureUrlProtocol(
  url: string,
  { defaultProtocol = 'https' }: EnsureUrlProtocolOptions = {}
): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  return `${defaultProtocol}://${url}`
}

/**
 * Builds an absolute URL from a configured base URL, path, and optional query parameters.
 *
 * @param baseUrl - Configured absolute base URL, if available.
 * @param path - Path to append.
 * @param query - Query values; nullish entries are omitted.
 * @returns The resolved URL, or undefined when the base URL is absent.
 */
export function buildUrl(baseUrl: string, path: string, query?: Record<string, UrlQueryValue>): string
export function buildUrl(baseUrl: string | undefined, path: string, query?: Record<string, UrlQueryValue>): string | undefined
export function buildUrl(
  baseUrl: string | undefined,
  path: string,
  query: Record<string, UrlQueryValue> = {},
): string | undefined {
  if (!baseUrl) return undefined

  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    url.searchParams.set(key, String(value))
  }

  return url.toString()
}

/**
 * Safely joins a configured base URL and path.
 *
 * @param baseUrl - Configured absolute base URL, if available.
 * @param path - Path to append.
 * @returns The resolved URL, or undefined when the base URL is absent.
 */
export function joinUrl(baseUrl: string, path: string): string
export function joinUrl(baseUrl: string | undefined, path: string): string | undefined
export function joinUrl(baseUrl: string | undefined, path: string): string | undefined {
  return buildUrl(baseUrl, path)
}
