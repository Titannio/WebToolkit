import { describe, it, expect } from 'vitest'
import { detectChanges, hasFormChanges, uniqueBy } from '@src/data/objects.js'

describe('objects utility', () => {
    describe('uniqueBy', () => {
        it('should keep the first item for each key', () => {
            const items = [
                { id: 'a', value: 1 },
                { id: 'b', value: 2 },
                { id: 'a', value: 3 },
            ]

            expect(uniqueBy(items, (item) => item.id)).toEqual([
                { id: 'a', value: 1 },
                { id: 'b', value: 2 },
            ])
        })

        it('should support symbol and number keys', () => {
            const symbolKey = Symbol('key')
            const items = [{ key: symbolKey }, { key: symbolKey }, { key: 1 }]

            expect(uniqueBy(items, (item) => item.key)).toEqual([{ key: symbolKey }, { key: 1 }])
        })
    })

    describe('detectChanges', () => {
        it('should detect changes', () => {
            const initial = { a: 1, b: 2 }
            const current = { a: 1, b: 3 }
            expect(detectChanges(initial, current)).toBe(true)
        })

        it('should respect excludeFields', () => {
            const initial = { a: 1, b: 2, updatedAt: '2023-01-01' }
            const current = { a: 1, b: 2, updatedAt: '2023-01-02' }
            expect(detectChanges(initial, current, ['updatedAt'])).toBe(false)
            expect(detectChanges(initial, current)).toBe(true)
        })

        it('should handle null initial state', () => {
            expect(detectChanges(null, { a: 1 })).toBe(false)
        })

        it('should expose a typed form alias', () => {
            expect(hasFormChanges({ a: 1 }, { a: 2 })).toBe(true)
            expect(hasFormChanges({ a: 1 }, { a: 2 }, ['a'])).toBe(false)
        })
    })
})
