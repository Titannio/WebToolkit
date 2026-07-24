import { useState, useEffect } from 'react'

/**
 * Custom hook for debouncing values.
 * 
 * Delays the update of a value until a specified amount of time has passed
 * since the last change. Useful for search inputs and other frequent updates.
 * 
 * @template T - The type of the value to debounce.
 * @param {T} value - The value to be debounced.
 * @param {number} [delay=300] - The delay in milliseconds (default: 300ms).
 * @returns {T} The debounced value.
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value)

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value)
        }, delay)

        return () => {
            clearTimeout(handler)
        }
    }, [value, delay])

    return debouncedValue
}
