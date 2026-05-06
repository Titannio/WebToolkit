/**
 * @module mongo.update
 * @description Helpers for building MongoDB atomic update payloads.
 */

/**
 * Checks whether a value can be expanded into nested `$set` paths.
 *
 * @param {unknown} value - Candidate branch value.
 * @returns {value is Record<string, unknown>} Type guard result.
 */
function isMongoSetBranchObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.getPrototypeOf(value) === Object.prototype
}

/**
 * Flattens nested objects into dot-notation paths for Mongo `$set`.
 *
 * @param {Record<string, unknown>} input - Nested input object.
 * @param {string} [prefix=''] - Optional path prefix.
 * @returns {Record<string, unknown>} Flattened path-value map.
 */
export function toSetPaths(input: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value === undefined) continue

    if (isMongoSetBranchObject(value)) {
      Object.assign(result, toSetPaths(value, path))
      continue
    }

    result[path] = value
  }

  return result
}
