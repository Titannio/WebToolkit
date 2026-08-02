import { createHash, timingSafeEqual } from 'node:crypto'

export * from './password.js'

/**
 * Returns the SHA-256 hexadecimal digest of a complete value.
 *
 * @param value - UTF-8 text or binary input.
 * @returns Lowercase hexadecimal SHA-256 digest.
 */
export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Extracts a token from a Bearer authorization header.
 *
 * @param {string | null | undefined} authorization - Authorization header.
 * @returns {string | null} Bearer token or null for an invalid header.
 */
export function extractBearerToken(authorization: string | null | undefined): string | null {
  const match = authorization?.trim().match(/^Bearer[ \t]+(\S+)$/i)
  return match?.[1] ?? null
}

/**
 * Compares UTF-8 strings without leaking their length through the final comparison.
 *
 * @param {string} left - First value.
 * @param {string} right - Second value.
 * @returns {boolean} Whether the values are equal.
 */
export function timingSafeEqualStrings(left: string, right: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()
  return timingSafeEqual(digest(left), digest(right))
}
