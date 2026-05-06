/**
 * @module objects.utils
 * @description Utility functions for deep object comparison and change detection.
 */

import { isEqual as deepEqual } from 'es-toolkit'
import { pick, omit, isEmpty } from 'remeda'

export { deepEqual, pick, omit, isEmpty }

/**
 * Returns the first item for each unique key while preserving input order.
 *
 * @param {readonly T[]} items - Items to de-duplicate.
 * @param {(item: T) => PropertyKey} getKey - Key selector.
 * @returns {T[]} Items with duplicate keys removed.
 */
export function uniqueBy<T>(items: readonly T[], getKey: (item: T) => PropertyKey): T[] {
    const seen = new Set<PropertyKey>()

    return items.filter((item) => {
        const key = getKey(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

/**
 * Detects if there are changes between two objects.
 * 
 * @param {T | null} initial - The original/initial state.
 * @param {T} current - The current/modified state.
 * @param {string[]} [excludeFields=[]] - List of property names to skip during comparison.
 * @returns {boolean} - True if any non-excluded fields differ.
 */
export function detectChanges<T extends object>(
    initial: T | null,
    current: T,
    excludeFields: Array<keyof T | string> = []
): boolean {
    if (!initial) return false;

    const excludedKeys = excludeFields.map(String)
    return !deepEqual(
        omit(initial as Record<string, unknown>, excludedKeys),
        omit(current as Record<string, unknown>, excludedKeys)
    );
}

/**
 * Typed alias for change detection in form-like state objects.
 *
 * @param {T | null} initial - Initial state.
 * @param {T} current - Current state.
 * @param {(keyof T | string)[]} [excludeFields=[]] - Keys to skip.
 * @returns {boolean} True when non-excluded fields differ.
 */
export function hasFormChanges<T extends object>(
    initial: T | null,
    current: T,
    excludeFields: Array<keyof T | string> = []
): boolean {
    return detectChanges(initial, current, excludeFields)
}
