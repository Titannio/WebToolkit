/**
 * @module case.utils
 * @description String case conversion helpers for technical identifiers.
 */

const getNameParts = (value: string): string[] =>
  value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .split('-')
    .filter(Boolean)

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)

/**
 * Converts text to kebab-case for filenames, route slugs, and code generation.
 *
 * @param {string} value - Input text.
 * @returns {string} Kebab-case identifier.
 */
export function toKebabCase(value: string): string {
  return getNameParts(value).join('-')
}

/**
 * Converts text to camelCase for generated variable and property names.
 *
 * @param {string} value - Input text.
 * @returns {string} Camel-case identifier.
 */
export function toCamelCase(value: string): string {
  const parts = getNameParts(value)
  if (parts.length === 0) return ''

  return parts[0] + parts.slice(1).map(capitalize).join('')
}

/**
 * Converts text to PascalCase for generated type, class, and component names.
 *
 * @param {string} value - Input text.
 * @returns {string} Pascal-case identifier.
 */
export function toPascalCase(value: string): string {
  return getNameParts(value).map(capitalize).join('')
}
