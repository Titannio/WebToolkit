/**
 * @module search.text
 * @description Text normalization helpers for search and autocomplete flows.
 */

const MULTI_SPACE_REGEX = /\s+/g
const DIACRITIC_REGEX = /[\u0300-\u036f]/g
const DIACRITIC_CHAR_CLASSES: Record<string, string> = {
  a: '[aàáâãäå]',
  c: '[cç]',
  e: '[eèéêë]',
  i: '[iìíîï]',
  n: '[nñ]',
  o: '[oòóôõöø]',
  u: '[uùúûü]',
  y: '[yýÿ]',
}

/**
 * Normalizes text for search matching.
 *
 * @param {string | null | undefined} value - Raw text.
 * @returns {string} Normalized text.
 */
export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) return ''

  return value
    .normalize('NFD')
    .replace(DIACRITIC_REGEX, '')
    .toLowerCase()
    .replace(MULTI_SPACE_REGEX, ' ')
    .trim()
}

/**
 * Tokenizes text into unique normalized tokens for prefix search.
 *
 * @param {string | null | undefined} value - Raw text.
 * @returns {string[]} Unique normalized tokens.
 */
export function tokenizeForPrefixSearch(value: string | null | undefined): string[] {
  const normalized = normalizeSearchText(value)
  if (!normalized) return []

  return Array.from(new Set(normalized.split(' ').filter(Boolean)))
}

/**
 * Escapes regex metacharacters in plain text.
 *
 * @param {string} value - Raw text.
 * @returns {string} Escaped regex-safe text.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Builds a diacritic-insensitive regex from free text.
 *
 * @param {string} value - Raw search text.
 * @param {string} [flags='i'] - Regex flags.
 * @returns {RegExp} Compiled regex.
 */
export function buildDiacriticInsensitiveRegex(value: string, flags = 'i'): RegExp {
  const normalized = normalizeSearchText(value)
  if (!normalized) return /$^/

  const pattern = normalized
    .split('')
    .map((char) => {
      if (char === ' ') return '\\s+'
      return DIACRITIC_CHAR_CLASSES[char] ?? escapeRegex(char)
    })
    .join('')

  return new RegExp(pattern, flags)
}
