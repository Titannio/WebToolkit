/**
 * @module EnumUtils
 * @description Utility functions for handling enum-like constant objects and transforming them for UI components.
 */

/**
 * Internal cache for transformed options to prevent redundant computations.
 */
const optionsCache = new Map<object, { label: string; value: string }[]>()

/**
 * Utility to convert a constant object (labels mapping) into dropdown options.
 * Results are cached in memory for performance.
 * 
 * @template {string} T - The type of the value (usually a string union).
 * @param {Record<T, string>} labels - Object where keys are technical values and values are human-readable labels.
 * @returns {{ label: string; value: T }[]} - Array of { label, value } objects compatible with select/dropdown components.
 * 
 * @example
 * ```ts
 * const ROLES = { ADMIN: 'Administrator', USER: 'Standard User' };
 * const options = toOptions(ROLES);
 * // returns [{ label: 'Administrator', value: 'ADMIN' }, { label: 'Standard User', value: 'USER' }]
 * ```
 */
export const toOptions = <T extends string>(labels: Record<T, string>): { label: string; value: T }[] => {
    if (optionsCache.has(labels)) {
        return optionsCache.get(labels) as { label: string; value: T }[]
    }
    const options = Object.entries(labels).map(([value, label]) => ({ label: label as string, value: value as T }))
    optionsCache.set(labels, options)
    return options
}

/**
 * Utility to retrieve a human-readable label for a given technical value using a mapping object.
 * 
 * @param {string} value - The technical value to look up.
 * @param {Record<string, string>} labels - The mapping object containing value-to-label pairs.
 * @returns {string} - The corresponding label, or the original value if no mapping is found.
 */
export const getLabelFromValue = (value: string, labels: Record<string, string>): string =>
    labels[value] || value

