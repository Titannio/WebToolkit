import { describe, it, expect } from 'vitest'
import { cleanTree, normalizeId, removeUndefined, parseJSONDates } from '@src/data/json.js'

describe('JSON Utils', () => {
    describe('cleanTree', () => {
        it('should remove specified values recursively', () => {
            const input = {
                a: 'remove',
                b: {
                    c: 'keep',
                    d: 'remove'
                },
                e: ['keep', 'remove']
            }
            const expected = {
                b: { c: 'keep' },
                e: ['keep']
            }
            expect(cleanTree(input, 'remove')).toEqual(expected)
        })

        it('should remove empty objects and arrays', () => {
            const input = {
                emptyObj: {},
                emptyArr: [],
                nested: { empty: {} }
            }
            expect(cleanTree(input, 'val')).toBeUndefined()
        })

        it('should return value if not object/array', () => {
            expect(cleanTree(123, 'val')).toBe(123)
        })

        it('should skip inherited keys and prune empty objects inside arrays', () => {
            const proto = { inherited: 'remove' }
            const input = Object.create(proto) as Record<string, unknown>
            input.own = 'keep'
            input.list = [{}, { nested: 'keep' }]

            expect(cleanTree(input, 'remove')).toEqual({
                own: 'keep',
                list: [{ nested: 'keep' }],
            })
        })
    })

    describe('normalizeId', () => {
        it('should convert _id to id and remove __v', () => {
            const input = { _id: 'mongo-id', __v: 0, name: 'Test' }
            const result = normalizeId(input)
            expect(result.id).toBe('mongo-id')
            expect(result).not.toHaveProperty('_id')
            expect(result).not.toHaveProperty('__v')
            expect(result.name).toBe('Test')
        })

        it('should handle missing _id', () => {
            const input = { name: 'Test' }
            const result = normalizeId(input as any)
            expect(result.id).toBeUndefined()
        })
    })

    describe('removeUndefined', () => {
        it('should remove undefined values but keep nulls', () => {
            const input = {
                a: undefined,
                b: null,
                c: {
                    d: undefined,
                    e: 'val'
                },
                f: [1, undefined, 2]
            }
            const expected = {
                b: null,
                c: { e: 'val' },
                f: [1, 2]
            }
            expect(removeUndefined(input)).toEqual(expected)
        })

        it('should handle primities', () => {
            expect(removeUndefined(123)).toBe(123)
            expect(removeUndefined(undefined)).toBeUndefined()
        })

        it('should handle dates (pass through)', () => {
            const d = new Date()
            expect(removeUndefined(d)).toBe(d)
        })

        it('should ignore inherited properties while cleaning objects', () => {
            const proto = { inherited: 'value' }
            const input = Object.create(proto) as Record<string, unknown>
            input.own = 1
            input.skip = undefined

            expect(removeUndefined(input)).toEqual({ own: 1 })
        })
    })

    describe('parseJSONDates', () => {
        it('should convert ISO date strings to Date objects', () => {
            const iso = '2023-01-01T00:00:00.000Z'
            const input = {
                date: iso,
                nested: {
                    date: iso
                },
                array: [iso]
            }
            const result = parseJSONDates<any>(input)
            expect(result.date).toBeInstanceOf(Date)
            expect(result.date.toISOString()).toBe(iso)
            expect(result.nested.date).toBeInstanceOf(Date)
            expect(result.array[0]).toBeInstanceOf(Date)
        })

        it('should return Date object as is', () => {
            const date = new Date()
            expect(parseJSONDates<Date>(date)).toBe(date)
        })

        it('should return non-object, non-string data as is', () => {
            expect(parseJSONDates(123)).toBe(123)
            expect(parseJSONDates(true)).toBe(true)
        })

        it('should handle non-string values when fields are specified', () => {
            const input = { date: 123, nested: { date: 456 } }
            const result = parseJSONDates<any>(input, ['date'])
            expect(result.date).toBe(123)
            expect(result.nested.date).toBe(456)
        })

        it('should return original string if it is not an ISO date string', () => {
            const str = 'hello world'
            expect(parseJSONDates(str)).toBe(str)
        })

        it('should return original string if it is an invalid date string', () => {
            const invalid = '2023-99-99T00:00:00Z'
            expect(parseJSONDates(invalid)).toBe(invalid)
        })

        it('should parse top-level ISO string without fields arg', () => {
            const iso = '2023-01-01T00:00:00.000Z'
            const result = parseJSONDates<Date>(iso)
            expect(result).toBeInstanceOf(Date)
            expect(result.toISOString()).toBe(iso)
        })

        it('should only convert specified fields if provided', () => {
            const iso = '2023-01-01T00:00:00.000Z'
            const input = {
                date1: iso,
                date2: iso
            }
            const result = parseJSONDates<any>(input, ['date1'])
            expect(result.date1).toBeInstanceOf(Date)
            expect(result.date2).toBe(iso)
        })

        it('should recurse into objects even if key is not in fields', () => {
            const iso = '2023-01-01T00:00:00.000Z'
            const data = {
                meta: {
                    createdAt: iso
                }
            }
            const result = parseJSONDates<any>(data, ['createdAt'])
            expect(result.meta.createdAt).toBeInstanceOf(Date)
            expect(result.meta.createdAt.toISOString()).toBe(iso)
        })

        it('should ignore non-date strings', () => {
            const input = { val: 'not a date' }
            const result = parseJSONDates<any>(input)
            expect(result.val).toBe('not a date')
        })

        it('should handle non-ISO string values in fields mode', () => {
            const input = { createdAt: 'not-a-date' }
            const result = parseJSONDates<any>(input, ['createdAt'])
            expect(result.createdAt).toBe('not-a-date')
        })

        it('should handle non-string values in auto-detection mode', () => {
            const input = { a: 123 }
            const result = parseJSONDates<any>(input)
            expect(result.a).toBe(123)
        })

        it('should handle invalid ISO date string in an object', () => {
            const invalid = '2023-99-99T00:00:00Z'
            const input = { date: invalid }
            const result = parseJSONDates<any>(input)
            expect(result.date).toBe(invalid)
        })

        it('should return null or undefined as is', () => {
            expect(parseJSONDates(null)).toBeNull()
            expect(parseJSONDates(undefined)).toBeUndefined()
        })
    })

})








