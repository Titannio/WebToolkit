import { describe, it, expect, vi } from 'vitest'
import { MemoryCache } from '@src/runtime/cache/memory.js'

describe('MemoryCache', () => {
    it('should set and get values', () => {
        const cache = new MemoryCache<string>()
        cache.set('key1', 'value1')
        expect(cache.get('key1')).toBe('value1')
    })

    it('should return undefined for missing keys', () => {
        const cache = new MemoryCache<string>()
        expect(cache.get('missing')).toBeUndefined()
    })

    it('should check if key exists with has()', () => {
        const cache = new MemoryCache<number>()
        cache.set('key1', 123)
        expect(cache.has('key1')).toBe(true)
        expect(cache.has('missing')).toBe(false)
    })

    it('should delete keys', () => {
        const cache = new MemoryCache<boolean>()
        cache.set('key1', true)
        cache.delete('key1')
        expect(cache.has('key1')).toBe(false)
    })

    it('should clear all values', () => {
        const cache = new MemoryCache<any>()
        cache.set('a', 1)
        cache.set('b', 2)
        cache.clear()
        expect(cache.has('a')).toBe(false)
        expect(cache.has('b')).toBe(false)
    })

    it('should handle expiration', async () => {
        const cache = new MemoryCache<string>()
        cache.set('key1', 'value1', 50) // 50ms TTL
        expect(cache.get('key1')).toBe('value1')
        
        await new Promise(resolve => setTimeout(resolve, 60))
        expect(cache.get('key1')).toBeUndefined()
    })

    it('should expire entries and delete on get when TTL elapsed', () => {
        vi.useFakeTimers()
        const cache = new MemoryCache<string>()
        vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
        cache.set('key1', 'value1', 10)
        vi.setSystemTime(new Date('2025-01-01T00:00:00.020Z'))
        expect(cache.get('key1')).toBeUndefined()
        vi.clearAllTimers()
        vi.useRealTimers()
    })

    it('should clear timers when clearing cache', () => {
        vi.useFakeTimers()
        const cache = new MemoryCache<string>()
        cache.set('key1', 'value1', 100)
        cache.clear()
        vi.useRealTimers()
        expect(cache.has('key1')).toBe(false)
    })

    it('should apply a default TTL while allowing an explicit zero override', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
        const cache = new MemoryCache<string>({ defaultTtlMs: 10 })
        cache.set('expiring', 'value')
        cache.set('persistent', 'value', 0)

        vi.setSystemTime(new Date('2026-01-01T00:00:00.020Z'))
        expect(cache.get('expiring')).toBeUndefined()
        expect(cache.get('persistent')).toBe('value')
        vi.clearAllTimers()
        vi.useRealTimers()
    })

    it('should evict the least recently used entry and expose live size', () => {
        const cache = new MemoryCache<number>({ maxEntries: 2 })
        cache.set('a', 1)
        cache.set('b', 2)
        expect(cache.get('a')).toBe(1)
        cache.set('c', 3)

        expect(cache.get('b')).toBeUndefined()
        expect(cache.get('a')).toBe(1)
        expect(cache.get('c')).toBe(3)
        expect(cache.size).toBe(2)
    })

    it('should omit expired entries from size and reject invalid new options', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
        const cache = new MemoryCache({ defaultTtlMs: 10 })
        cache.set('key', 'value')
        vi.setSystemTime(new Date('2026-01-01T00:00:00.020Z'))

        expect(cache.size).toBe(0)
        expect(() => new MemoryCache({ defaultTtlMs: -1 })).toThrow('defaultTtlMs')
        expect(() => new MemoryCache({ defaultTtlMs: Number.POSITIVE_INFINITY })).toThrow('defaultTtlMs')
        expect(() => new MemoryCache({ maxEntries: 0 })).toThrow('maxEntries')
        expect(() => new MemoryCache({ maxEntries: 1.5 })).toThrow('maxEntries')
        vi.clearAllTimers()
        vi.useRealTimers()
    })
})
