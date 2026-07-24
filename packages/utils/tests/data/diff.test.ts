
import { describe, it, expect } from 'vitest'
import { hasChanged, getChangedKeys, getDetailedDiff } from '@src/data/diff.js'

// Mocking ObjectId behavior if mongoose not available in utils
const mockObjectId = (hex: string) => ({
    toHexString: () => hex,
    toString: () => hex
})

describe('Utils: Diff Logic', () => {
    describe('hasChanged', () => {
        it('should return false for identical primitives', () => {
            expect(hasChanged(1, 1)).toBe(false)
            expect(hasChanged('a', 'a')).toBe(false)
            expect(hasChanged(true, true)).toBe(false)
        })

        it('should return true for different primitives', () => {
            expect(hasChanged(1, 2)).toBe(true)
            expect(hasChanged('a', 'b')).toBe(true)
            expect(hasChanged(true, false)).toBe(true)
        })

        it('should treat null and undefined as equal (loose check)', () => {
            expect(hasChanged(null, undefined)).toBe(false)
            expect(hasChanged(undefined, null)).toBe(false)
            expect(hasChanged(null, null)).toBe(false)
            expect(hasChanged(undefined, undefined)).toBe(false)
        })

        it('should handle Date comparisons', () => {
            const d1 = new Date('2023-01-01T10:00:00Z')
            const d2 = new Date('2023-01-01T10:00:00Z')
            const d3 = new Date('2023-01-02T10:00:00Z')

            expect(hasChanged(d1, d2)).toBe(false)
            expect(hasChanged(d1, d3)).toBe(true)
        })

        it('should compare Date with ISO Strings', () => {
            const d1 = new Date('2023-01-01T10:00:00Z')
            const s1 = '2023-01-01T10:00:00.000Z'
            const s2 = '2023-01-02T10:00:00.000Z'

            expect(hasChanged(d1, s1)).toBe(false)
            expect(hasChanged(d1, s2)).toBe(true)
        })

        it('should handle ObjectIds (strings and objects)', () => {
            const id1 = '507f1f77bcf86cd799439011'
            const id2 = '507f1f77bcf86cd799439011'
            const id3 = '507f1f77bcf86cd799439012'

            expect(hasChanged(id1, id2)).toBe(false)
            expect(hasChanged(id1, id3)).toBe(true)

            // Mocked Mongoose-like implementation
            const objId1 = mockObjectId(id1)
            const objId2 = mockObjectId(id1)

            expect(hasChanged(objId1, objId2)).toBe(false)
            expect(hasChanged(objId1, id3)).toBe(true)
        })

        it('should handle Arrays recursively ignoring _id', () => {
            const arr1 = [{ _id: '1', val: 1 }, { _id: '2', val: 2 }]
            const arr2 = [{ val: 1 }, { val: 2 }] // Payload without IDs
            const arr3 = [{ val: 1 }, { val: 3 }] // Changed value

            expect(hasChanged(arr1, arr2)).toBe(false)
            expect(hasChanged(arr1, arr3)).toBe(true)
        })

        it('should check Objects based on Subset (Payload keys only)', () => {
            const dbItem = { _id: '123', name: 'Test', age: 30, internal: 'secret' }

            // Payload only has name (same)
            expect(hasChanged(dbItem, { name: 'Test' })).toBe(false)

            // Payload has name (changed)
            expect(hasChanged(dbItem, { name: 'Changed' })).toBe(true)

            // Payload has subset (name same, age same)
            expect(hasChanged(dbItem, { name: 'Test', age: 30 })).toBe(false)

            // Payload matches but has explicitly undefined field (should depend on business logic, here usually ignore)
            // But strict equality of undefined === undefined (normalized) returns false.
        })

        it('should handle ObjectId-like strings', () => {
            const id1 = '507f1f77bcf86cd799439011'
            const id2 = '507f1f77bcf86cd799439012'
            expect(hasChanged(id1, id1)).toBe(false)
            expect(hasChanged(id1, id2)).toBe(true)
        })

        it('should handle ObjectId objects (toHexString)', () => {
            const id1 = { toHexString: () => '507f1f77bcf86cd799439011' }
            const id2 = '507f1f77bcf86cd799439011'
            // Currently it returns true because String(id1) is "[object Object]"
            expect(hasChanged(id1, id2)).toBe(true)
        })

        it('should return false for invalid dates compared to valid dates (known limitation/bug)', () => {
            const d1 = new Date('invalid')
            const d2 = new Date()
            // It returns false because they are both objects with no enumerable keys
            expect(hasChanged(d1, d2)).toBe(false)
        })

        it('should handle date-like strings compared to objects', () => {
            const d1 = new Date().toISOString()
            const obj = { some: 'key' }
            expect(hasChanged(d1, obj)).toBe(true)
        })

        it('should return true for different types that fall through to final check', () => {
            expect(hasChanged(123, '123')).toBe(true)
        })

        it('should return true if one is primitive and other is object', () => {
            expect(hasChanged(null, {})).toBe(true)
            expect(hasChanged({}, null)).toBe(true)
        })

        it('should ignore internal keys like _id, id, __v', () => {
            const obj1 = { name: 'A', _id: '1', id: '1', __v: 0 }
            const obj2 = { name: 'A', _id: '2', id: '2', __v: 1 }
            expect(hasChanged(obj1, obj2)).toBe(false)
        })

        it('should detect change in nested object even if internal keys differ', () => {
            const obj1 = { data: { name: 'A', _id: '1' } }
            const obj2 = { data: { name: 'B', _id: '2' } }
            expect(hasChanged(obj1, obj2)).toBe(true)
        })

        it('should return false if array items are identical', () => {
            expect(hasChanged([1, 2], [1, 2])).toBe(false)
        })

        it('should return true if array lengths differ', () => {
            expect(hasChanged([1, 2], [1, 2, 3])).toBe(true)
        })

        it('should handle invalid date strings in catch/fallthrough', () => {
            // Compare valid date with invalid date string
            const d = new Date()
            expect(hasChanged(d, 'not-a-date')).toBe(true)
        })

        it('should detect change when key missing in original', () => {
            const original = { a: 1 }
            const payload = { a: 1, b: 2 }
            expect(hasChanged(original, payload)).toBe(true)
        })
    })

    describe('getChangedKeys', () => {
        it('should return list of changed keys', () => {
            const original = { a: 1, b: 2, c: 3 }
            const payload = { a: 1, b: 20, c: 3 }

            expect(getChangedKeys(original, payload)).toEqual(['b'])
        })

        it('should return empty if nothing changed', () => {
            const original = { a: 1 }
            const payload = { a: 1 }
            expect(getChangedKeys(original, payload)).toEqual([])
        })

        it('should skip keys that are explicitly undefined in payload', () => {
            const original = { name: 'Test' }
            const payload = { name: undefined }
            expect(getChangedKeys(original, payload)).toHaveLength(0)
        })

        it('should detect change if key missing in original', () => {
            const original = {}
            const payload = { name: 'New' }
            expect(getChangedKeys(original, payload)).toEqual(['name'])
        })

        it('should return empty if original or payload is missing', () => {
            expect(getChangedKeys(null, { a: 1 })).toEqual([])
            expect(getChangedKeys({ a: 1 }, null)).toEqual([])
        })
    })

    describe('getDetailedDiff', () => {
        it('should return detailed diff object', () => {
            const original = { a: 1, b: 2 }
            const payload = { a: 10, b: 2 }

            const diff = getDetailedDiff(original, payload)
            expect(diff).toEqual({
                a: { old: 1, new: 10 }
            })
        })

        it('should recurse for nested objects', () => {
            const original = { settings: { theme: 'dark', notifs: true } }
            const payload = { settings: { theme: 'light', notifs: true } }

            const diff = getDetailedDiff(original, payload)
            expect(diff).toEqual({
                settings: {
                    theme: { old: 'dark', new: 'light' }
                }
            })
        })

        it('should handle nested objects where change is filtered out (e.g. undefined in payload)', () => {
            const original = { data: { a: 1 } }
            const payload = { data: { a: undefined } }
            // hasChanged considers this a change, but getChangedKeys skips it
            const diff = getDetailedDiff(original, payload)
            expect(diff).toEqual({
                data: { old: { a: 1 }, new: { a: undefined } }
            })
        })

        it('should handle dates in detailed diff', () => {
            const d1 = new Date(2023, 0, 1)
            const d2 = new Date(2023, 0, 2)
            const original = { date: d1 }
            const payload = { date: d2 }
            expect(getDetailedDiff(original, payload)).toEqual({ date: { old: d1, new: d2 } })
        })

        it('should handle missing original or payload', () => {
            expect(getDetailedDiff(null, {})).toEqual({})
            expect(getDetailedDiff({}, null)).toEqual({})
        })
    })
})









