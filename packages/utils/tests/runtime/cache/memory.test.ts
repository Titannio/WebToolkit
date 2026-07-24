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
})
