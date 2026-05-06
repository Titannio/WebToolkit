/**
 * @module url.utils
 * @description URL formatting helpers.
 */

export interface EnsureUrlProtocolOptions {
  /** Protocol to prepend when the URL has no explicit protocol. */
  defaultProtocol?: 'http' | 'https'
}

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
