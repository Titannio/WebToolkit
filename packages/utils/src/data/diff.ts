/**
 * @module diff.utils
 * @description Utility functions for comparing values and detecting changes.
 * Useful for logging, auditing, and determining update operations.
 */

/**
 * Checks if a value resembles a MongoDB ObjectId.
 * 
 * Validates against a 24-character hexadecimal string or an object
 * that implements the `toHexString` method (typical for MongoDB drivers).
 * 
 * @param {unknown} val - The value to inspect.
 * @returns {boolean} - True if the value can be treated as an ObjectId.
 */
function isObjectIdLike(val: unknown): boolean {
    if (!val) return false

    if (typeof val === 'object' && 'toHexString' in val && typeof (val as { toHexString: unknown }).toHexString === 'function') {
        return true
    }

    const str = String(val)
    return /^[0-9a-fA-F]{24}$/.test(str)
}

/**
 * Normalizes values to facilitate loose but meaningful comparisons.
 * 
 * Specifically, it treats `null` as `undefined` to allow consistent traversal
 * of optional fields that may alternate between these states in database results.
 * 
 * @param {unknown} val - The value to normalize.
 * @returns {unknown} - The normalized value (null becomes undefined).
 */
function normalizeVal(val: unknown): unknown {
    if (val === null || val === undefined) return undefined
    return val
}

/**
 * Performs a deep comparison between two values to detect significant changes.
 * 
 * This utility handles a broad range of types with domain-specific logic:
 * - **Primitives**: Uses strict inequality after normalization.
 * - **Dates**: Compares numeric timestamps, including ISO string parsing.
 * - **ObjectIds**: Uses string representation for comparison.
 * - **Arrays**: Recursive item-by-item comparison (strict order).
 * - **Objects**: Performs a subset check based on the keys present in `newVal`.
 *   Internal keys like `_id`, `id`, and `__v` are ignored during object comparison.
 * 
 * @param {unknown} oldVal - The baseline value for comparison.
 * @param {unknown} newVal - The proposed change for comparison.
 * @returns {boolean} - True if the values are considered different, false otherwise.
 * 
 * @example
 * hasChanged({ a: 1 }, { a: 2 }) // true
 * hasChanged(new Date('2023-01-01'), '2023-01-01T00:00:00.000Z') // false
 */
export function hasChanged(oldVal: unknown, newVal: unknown): boolean {
    const v1 = normalizeVal(oldVal)
    const v2 = normalizeVal(newVal)

    // 1. Strict equality check (fast path)
    if (v1 === v2) return false

    // 3. Handle Dates and Date-like Strings
    const isV1Date = v1 instanceof Date
    const isV2Date = v2 instanceof Date
    const isV1DateStr = typeof v1 === 'string' && !isNaN(Date.parse(v1))

    if (isV1Date || isV2Date || (isV1DateStr && typeof v2 === 'object')) {
        try {
            const t1 = v1 instanceof Date ? v1.getTime() : new Date(v1 as string | number).getTime()
            const t2 = v2 instanceof Date ? v2.getTime() : new Date(v2 as string | number).getTime()

            if (!isNaN(t1) && !isNaN(t2)) {
                return t1 !== t2
            }
        } catch {
            // Fall through if parsing fails
        }
    }

    // 4. ObjectId comparison
    if (isObjectIdLike(v1) && isObjectIdLike(v2)) {
        return String(v1) !== String(v2)
    }

    // 5. Array comparison (Strict order, recursive)
    if (Array.isArray(v1) && Array.isArray(v2)) {
        if (v1.length !== v2.length) return true
        for (let i = 0; i < v1.length; i++) {
            if (hasChanged(v1[i], v2[i])) return true
        }
        return false
    }

    // 6. Object comparison (Recursive Subset Check)
    if (v1 && v2 && typeof v1 === 'object' && typeof v2 === 'object') {
        const payloadKeys = Object.keys(v2)

        for (const key of payloadKeys) {
            if (key === '_id' || key === 'id' || key === '__v') continue

            if (hasChanged((v1 as Record<string, unknown>)[key], (v2 as Record<string, unknown>)[key])) {
                return true
            }
        }
        return false
    }

    // 7. Fallback: primitives or mismatched types
    return v1 !== v2
}

/**
 * Identifies keys in a payload that differ from their counterparts in an original object.
 * 
 * Filters out keys that are `undefined` in the payload or match the original
 * value after deep comparison. Useful for minimizing database updates.
 * 
 * @param {Record<string, unknown> | null | undefined} original - The source object (e.g., current state from DB).
 * @param {Record<string, unknown> | null | undefined} payload - The proposed changes (e.g., request body).
 * @returns {string[]} - A list of keys that represent actual changes.
 */
export function getChangedKeys(original: Record<string, unknown> | null | undefined, payload: Record<string, unknown> | null | undefined): string[] {
    if (!original || !payload) return []

    return Object.keys(payload).filter(key => {
        if (payload[key] === undefined) return false
        if (!(key in original)) return true
        return hasChanged(original[key], payload[key])
    })
}

/**
 * Generates a detailed difference report between two objects.
 * 
 * For each changed key, provides the original (`old`) and new (`new`) values.
 * Supports a single level of recursion for nested objects (excluding Arrays, Dates, or ObjectIds).
 * 
 * @param {Record<string, unknown> | null | undefined} original - The baseline object.
 * @param {Record<string, unknown> | null | undefined} payload - The object containing potentially new values.
 * @returns {Record<string, { old: unknown, new: unknown }>} - A map where keys are changed properties and values contain the old/new state.
 * 
 * @example
 * getDetailedDiff({ price: 100 }, { price: 120 }) 
 * // returns { price: { old: 100, new: 120 } }
 */
export function getDetailedDiff(
    original: Record<string, unknown> | null | undefined,
    payload: Record<string, unknown> | null | undefined
): Record<string, { old: unknown, new: unknown }> {
    const diff: Record<string, { old: unknown, new: unknown }> = {}
    if (!original || !payload) return diff

    const changedKeys = getChangedKeys(original, payload)

    for (const key of changedKeys) {
        const v1 = original[key]
        const v2 = payload[key]

        if (
            v1 && v2 &&
            typeof v1 === 'object' && typeof v2 === 'object' &&
            !Array.isArray(v1) && !Array.isArray(v2) &&
            !(v1 instanceof Date) && !(v2 instanceof Date) &&
            !isObjectIdLike(v1)
        ) {
            const nestedDiff = getDetailedDiff(v1 as Record<string, unknown>, v2 as Record<string, unknown>)
            if (Object.keys(nestedDiff).length > 0) {
                diff[key] = nestedDiff as unknown as { old: unknown, new: unknown }
            } else {
                diff[key] = { old: v1, new: v2 }
            }
        } else {
            diff[key] = { old: v1, new: v2 }
        }
    }

    return diff
}









