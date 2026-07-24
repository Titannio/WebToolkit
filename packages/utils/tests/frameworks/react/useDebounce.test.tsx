/**
 * Tests for the useDebounce hook.
 * Demonstrates basic hook testing with Vitest and React Testing Library.
 */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useDebounce } from '@src/frameworks/react/useDebounce.js'

describe('useDebounce', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('should return initial value immediately', () => {
        const { result } = renderHook(() => useDebounce('initial', 300))
        expect(result.current).toBe('initial')
    })

    it('should debounce value changes', () => {
        const { result, rerender } = renderHook(
            ({ value, delay }) => useDebounce(value, delay),
            { initialProps: { value: 'initial', delay: 300 } }
        )

        // Initial value
        expect(result.current).toBe('initial')

        // Update value
        rerender({ value: 'updated', delay: 300 })

        // Value should not have changed yet
        expect(result.current).toBe('initial')

        // Fast-forward time
        act(() => {
            vi.advanceTimersByTime(300)
        })

        // Now value should be updated
        expect(result.current).toBe('updated')
    })

    it('should reset timer on rapid value changes', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebounce(value, 300),
            { initialProps: { value: 'first' } }
        )

        // Multiple rapid updates
        rerender({ value: 'second' })
        act(() => {
            vi.advanceTimersByTime(100)
        })

        rerender({ value: 'third' })
        act(() => {
            vi.advanceTimersByTime(100)
        })

        rerender({ value: 'fourth' })

        // Should still be first value
        expect(result.current).toBe('first')

        // Wait for full debounce time from last update
        act(() => {
            vi.advanceTimersByTime(300)
        })

        expect(result.current).toBe('fourth')
    })

    it('should respect custom delay', () => {
        const { result, rerender } = renderHook(
            ({ value, delay }) => useDebounce(value, delay),
            { initialProps: { value: 'initial', delay: 500 } }
        )

        rerender({ value: 'updated', delay: 500 })

        // Should not update after 300ms
        act(() => {
            vi.advanceTimersByTime(300)
        })
        expect(result.current).toBe('initial')

        // Should update after full 500ms
        act(() => {
            vi.advanceTimersByTime(200)
        })

        expect(result.current).toBe('updated')
    })

    it('should use default delay of 300ms', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebounce(value),
            { initialProps: { value: 'initial' } }
        )

        rerender({ value: 'updated' })

        // Should not update before 300ms
        act(() => {
            vi.advanceTimersByTime(299)
        })
        expect(result.current).toBe('initial')

        // Should update after 300ms
        act(() => {
            vi.advanceTimersByTime(1)
        })

        expect(result.current).toBe('updated')
    })
})
