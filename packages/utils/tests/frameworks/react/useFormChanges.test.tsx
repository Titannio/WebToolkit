import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFormChanges } from '@src/frameworks/react/useFormChanges.js'

describe('useFormChanges', () => {
  it('should detect no changes when data is identical', () => {
    const initialData = { name: 'John', age: 30 }
    const currentData = { name: 'John', age: 30 }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(false)
  })

  it('should detect changes when data is modified', () => {
    const initialData = { name: 'John', age: 30 }
    const currentData = { name: 'Jane', age: 30 }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(true)
  })

  it('should detect changes when nested properties are modified', () => {
    const initialData = { user: { name: 'John', address: { city: 'NYC' } } }
    const currentData = { user: { name: 'John', address: { city: 'LA' } } }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(true)
  })

  it('should detect changes when array items are added', () => {
    const initialData = { items: [1, 2, 3] }
    const currentData = { items: [1, 2, 3, 4] }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(true)
  })

  it('should detect changes when array items are removed', () => {
    const initialData = { items: [1, 2, 3] }
    const currentData = { items: [1, 2] }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(true)
  })

  it('should detect no changes when arrays have same items in same order', () => {
    const initialData = { items: [1, 2, 3] }
    const currentData = { items: [1, 2, 3] }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(false)
  })

  it('should detect changes when array order is different', () => {
    const initialData = { items: [1, 2, 3] }
    const currentData = { items: [3, 2, 1] }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(true)
  })

  it('should handle empty objects', () => {
    const initialData = {}
    const currentData = {}

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(false)
  })

  it('should detect changes when property is added', () => {
    const initialData = { name: 'John' }
    const currentData = { name: 'John', age: 30 }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(true)
  })

  it('should detect changes when property is removed', () => {
    const initialData = { name: 'John', age: 30 }
    const currentData = { name: 'John' }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(true)
  })

  it('should normalize dates when comparing data', () => {
    const date1 = new Date('2023-01-01T10:00:00Z')
    const date2 = new Date('2023-01-01T15:00:00Z')
    const initialData = { date: date1 }
    const currentData = { date: date2 }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(false)
  })

  it('should update hasChanges when currentData changes', () => {
    const initialData = { name: 'John', age: 30 }

    const { result, rerender } = renderHook(
      ({ current }: { current: { name: string; age: number } }) => useFormChanges(initialData, current),
      { initialProps: { current: { name: 'John', age: 30 } } }
    )

    expect(result.current.hasChanges).toBe(false)

    rerender({ current: { name: 'Jane', age: 30 } })
    expect(result.current.hasChanges).toBe(true)

    rerender({ current: { name: 'John', age: 30 } })
    expect(result.current.hasChanges).toBe(false)
  })

  it('should provide resetChanges function that returns initial data', () => {
    const initialData = { name: 'John', age: 30 }
    const currentData = { name: 'Jane', age: 25 }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    const resetData = result.current.resetChanges()
    expect(resetData).toEqual(initialData)
  })

  it('should handle null and undefined values', () => {
    const initialData = { name: 'John', age: null, city: undefined }
    const currentData = { name: 'John', age: null, city: undefined }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(false)
  })

  it('should detect changes when null becomes a value', () => {
    const initialData: { name: string; age: number | null } = { name: 'John', age: null }
    const currentData: { name: string; age: number | null } = { name: 'John', age: 30 }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(true)
  })

  it('should treat null, undefined, and missing optional keys as equivalent', () => {
    type Data = { personGender?: string | null }
    const initialData: Data = { personGender: undefined }
    const currentData: Data = { personGender: null }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))
    expect(result.current.hasChanges).toBe(false)

    const { result: resultWithoutKey } = renderHook(() => useFormChanges(initialData, {} as Data))
    expect(resultWithoutKey.current.hasChanges).toBe(false)
  })

  it('should handle complex nested structures', () => {
    const initialData = {
      user: {
        name: 'John',
        contacts: [
          { type: 'email', value: 'john@example.com' },
          { type: 'phone', value: '123456789' }
        ]
      }
    }
    const currentData = {
      user: {
        name: 'John',
        contacts: [
          { type: 'email', value: 'john@example.com' },
          { type: 'phone', value: '987654321' }
        ]
      }
    }

    const { result } = renderHook(() => useFormChanges(initialData, currentData))

    expect(result.current.hasChanges).toBe(true)
  })

  it('should update initial data reference when it changes', () => {
    const { result, rerender } = renderHook(
      ({ initial, current }: { initial: { name: string; age: number }; current: { name: string; age: number } }) =>
        useFormChanges(initial, current),
      {
        initialProps: {
          initial: { name: 'John', age: 30 },
          current: { name: 'John', age: 30 }
        }
      }
    )

    expect(result.current.hasChanges).toBe(false)

    // Update initial data (simulating a save operation)
    rerender({
      initial: { name: 'Jane', age: 25 },
      current: { name: 'Jane', age: 25 }
    })

    expect(result.current.hasChanges).toBe(false)

    // Now modify current data
    rerender({
      initial: { name: 'Jane', age: 25 },
      current: { name: 'Jane', age: 26 }
    })

    expect(result.current.hasChanges).toBe(true)
  })
})
