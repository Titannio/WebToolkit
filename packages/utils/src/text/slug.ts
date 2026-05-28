/**
 * @module slug.utils
 * @description Text normalization helper for generating URL-friendly slugs.
 */

/**
 * Removes combining diacritic marks while preserving the base characters.
 *
 * @param {string} value - Input string to normalize.
 * @returns {string} String without combining diacritic marks.
 */
function removeDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Converts free-form text into a lowercase ASCII slug separated by hyphens.
 *
 * @param {string} value - Raw text to normalize.
 * @returns {string} URL-friendly slug, or an empty string when no token remains.
 */
export function toSlug(value: string): string {
  if (!value) return ''

  return removeDiacritics(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}
