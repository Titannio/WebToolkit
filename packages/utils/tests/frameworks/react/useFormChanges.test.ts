import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFormChanges } from '@src/frameworks/react/useFormChanges.js'

describe('useFormChanges', () => {
  it('should detect changes in simple values', () => {
    const initial = { name: 'John', age: 30 }
    const { result, rerender } = renderHook(
      ({ initial, current }) => useFormChanges(initial, current),
      { initialProps: { initial, current: initial } }
    )

    expect(result.current.hasChanges).toBe(false)

    rerender({ initial, current: { ...initial, name: 'Jane' } })
    expect(result.current.hasChanges).toBe(true)

    rerender({ initial, current: { ...initial, age: 31 } })
    expect(result.current.hasChanges).toBe(true)

    rerender({ initial, current: initial })
    expect(result.current.hasChanges).toBe(false)
  })

  it('should handle nested objects and arrays', () => {
    const initial = {
      user: { name: 'John', tags: ['a', 'b'] },
      metadata: { lastLogin: null }
    }
    const { result, rerender } = renderHook(
      ({ initial, current }) => useFormChanges(initial, current),
      { initialProps: { initial, current: initial } }
    )

    expect(result.current.hasChanges).toBe(false)

    rerender({ initial, current: { ...initial, user: { ...initial.user, name: 'Jane' } } })
    expect(result.current.hasChanges).toBe(true)

    rerender({ initial, current: { ...initial, user: { ...initial.user, tags: ['a', 'c'] } } })
    expect(result.current.hasChanges).toBe(true)
  })

  it('should normalize dates to midnight UTC', () => {
    // Two dates with same YMD but different times
    const initial = { date: new Date('2023-01-01T10:00:00Z') }
    const current = { date: new Date('2023-01-01T20:00:00Z') }

    const { result } = renderHook(
      () => useFormChanges(initial, current)
    )

    // They should be considered the same because they are normalized to midnight UTC
    expect(result.current.hasChanges).toBe(false)

    // A different day should trigger a change
    const differentDay = { date: new Date('2023-01-02T10:00:00Z') }
    const { result: resultDiff } = renderHook(
      () => useFormChanges(initial, differentDay)
    )
    expect(resultDiff.current.hasChanges).toBe(true)
  })

  it('should handle null and undefined in objects', () => {
    const initial = { a: 1, b: null as number | null, c: undefined as number | undefined }
    const { result, rerender } = renderHook(
      ({ initial, current }) => useFormChanges(initial, current),
      { initialProps: { initial, current: initial } }
    )

    expect(result.current.hasChanges).toBe(false)

    rerender({ initial, current: { ...initial, b: 2 } })
    expect(result.current.hasChanges).toBe(true)

    rerender({ initial, current: { ...initial, c: 3 } })
    expect(result.current.hasChanges).toBe(true)
  })

  it('should treat null, undefined, and missing optional keys as equivalent', () => {
    type Data = { personGender?: string | null }
    const initial: Data = { personGender: undefined }
    const currentWithNull: Data = { personGender: null }
    const currentWithoutKey: Data = {}

    const { result, rerender } = renderHook(
      ({ initial, current }) => useFormChanges(initial, current),
      { initialProps: { initial, current: currentWithNull } }
    )

    expect(result.current.hasChanges).toBe(false)

    rerender({ initial, current: currentWithoutKey })
    expect(result.current.hasChanges).toBe(false)
  })

  it('should treat nested null and missing keys as equivalent', () => {
    const initial = { personInfo: { gender: null as string | null } }
    const current = { personInfo: {} }

    const { result } = renderHook(() => useFormChanges(initial, current))
    expect(result.current.hasChanges).toBe(false)
  })

  it('should ignore non-own properties on objects', () => {
    const proto = { inherited: 'value' }
    const initial = Object.create(proto)
    initial.own = 'own'

    const current = Object.create(proto)
    current.own = 'own'

    const { result } = renderHook(() => useFormChanges(initial, current))
    expect(result.current.hasChanges).toBe(false)
  })

  it('should provide a reset function', () => {
    const initial = { name: 'John' }
    const current = { name: 'Jane' }
    const { result } = renderHook(() => useFormChanges(initial, current))

    expect(result.current.hasChanges).toBe(true)

    let resetData
    act(() => {
      resetData = result.current.resetChanges()
    })

    expect(resetData).toEqual(initial)
  })

  it('should update initial reference when initialData changes', () => {
    const initial1 = { name: 'John' }
    const initial2 = { name: 'Jane' }

    const { result, rerender } = renderHook(
      ({ initial, current }) => useFormChanges(initial, current),
      { initialProps: { initial: initial1, current: initial1 } }
    )

    expect(result.current.hasChanges).toBe(false)

    // Change initial data, current matches new initial
    rerender({ initial: initial2, current: initial2 })
    expect(result.current.hasChanges).toBe(false)

    // Current is now different from current initial (initial2)
    rerender({ initial: initial2, current: initial1 })
    expect(result.current.hasChanges).toBe(true)
  })
})
