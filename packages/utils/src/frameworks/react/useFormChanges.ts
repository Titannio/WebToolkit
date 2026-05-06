import { useRef, useMemo } from 'react'

/**
 * Type guard to check if a value is a Date object.
 * @param {unknown} value - The value to check.
 * @returns {boolean} - True if value is a valid Date instance.
 */
const isDate = (value: unknown): value is Date => {
  return value instanceof Date && !isNaN(value.getTime())
}

/**
 * Type guard to check if a value is a plain object (not Date, not Array, not null).
 * @param {unknown} value - The value to check.
 * @returns {boolean} - True if value is a plain record object.
 */
const isFormDiffPlainObject = (value: unknown): value is Record<string, unknown> => {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  )
}

/**
 * Normalizes dates in an object to midnight UTC for consistent comparison.
 * This prevents false positives when comparing dates with different times.
 * @template T
 * @param {T} obj - The object or value to normalize.
 * @returns {T} - The normalized object or value.
 */
const normalizeDatesInObject = <T>(obj: T): T => {
  if (obj === null || obj === undefined) {
    return null as T
  }

  if (isDate(obj)) {
    // Normalize to midnight UTC
    return new Date(Date.UTC(obj.getUTCFullYear(), obj.getUTCMonth(), obj.getUTCDate())) as T
  }

  if (Array.isArray(obj)) {
    return obj.map(normalizeDatesInObject) as T
  }

  if (isFormDiffPlainObject(obj)) {
    const normalized: Record<string, unknown> = {}
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        const normalizedValue = normalizeDatesInObject(obj[key])
        // For comparison only, treat null/undefined/absent as equivalent in optional object fields.
        if (normalizedValue !== null && normalizedValue !== undefined) {
          normalized[key] = normalizedValue
        }
      }
    }
    return normalized as T
  }

  return obj
}

/**
 * Hook to track form changes and provide pending changes state.
 * 
 * @template T - The type of the data being tracked.
 * @param {T} initialData - The original data to compare against.
 * @param {T} currentData - The current form data.
 * @returns {{ hasChanges: boolean; resetChanges: () => T }} An object with hasChanges flag and helper functions.
 * 
 * @example
 * ```tsx
 * const { hasChanges } = useFormChanges(originalUser, formData)
 * 
 * <Button disabled={!hasChanges}>
 *   Save Changes
 * </Button>
 * {hasChanges && <Text size="xs" c="dimmed">Unsaved changes</Text>}
 * ```
 */
export const useFormChanges = <T>(initialData: T, currentData: T) => {
  // Normalize dates before stringifying to avoid timezone issues
  const normalizedInitialData = useMemo(() => normalizeDatesInObject(initialData), [initialData])
  const normalizedCurrentData = useMemo(() => normalizeDatesInObject(currentData), [currentData])

  // Use ref to store the stringified initial data to avoid infinite loops
  const initialDataStringRef = useRef<string>(JSON.stringify(normalizedInitialData))
  const currentInitialDataString = JSON.stringify(normalizedInitialData)

  // Only update the ref if the stringified value actually changed
  if (initialDataStringRef.current !== currentInitialDataString) {
    initialDataStringRef.current = currentInitialDataString
  }

  // Deep comparison to detect changes
  const hasChanges = useMemo(() => {
    return initialDataStringRef.current !== JSON.stringify(normalizedCurrentData)
  }, [normalizedCurrentData])

  // Reset to original data
  const resetChanges = (): T => {
    return initialData
  }

  return {
    hasChanges,
    resetChanges,
  }
}
