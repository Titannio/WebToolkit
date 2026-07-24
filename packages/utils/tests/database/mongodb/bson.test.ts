import { describe, it, expect } from 'vitest'
import { toPlain, extractId } from '@src/database/mongodb/bson.js'

describe('BSON Utils', () => {
    describe('toPlain', () => {
        it('should convert BSON Oid to string', () => {
            expect(toPlain({ $oid: '123' })).toBe('123')
        })

        it('should convert BSON Date to JS Date', () => {
            const date = new Date('2023-01-01T12:00:00Z')
            const result = toPlain({ $date: date.toISOString() }) as Date
            expect(result).toBeInstanceOf(Date)
            expect(result.toISOString()).toBe(date.toISOString())
        })

        it('should handle numeric BSON dates', () => {
            const result = toPlain({ $date: 1672531200000 }) as Date
            expect(result.getTime()).toBe(1672531200000)
        })

        it('should handle invalid BSON dates', () => {
            const result = toPlain({ $date: 'invalid' }) as Date
            expect(result).toBeInstanceOf(Date)
            expect(isNaN(result.getTime())).toBe(false)
        })

        it('should convert BSON numbers', () => {
            expect(toPlain({ $numberInt: '123' })).toBe(123)
            expect(toPlain({ $numberLong: '123456789' })).toBe(123456789)
            expect(toPlain({ $numberDouble: '123.45' })).toBe(123.45)
        })

        it('should return original if not BSON or object', () => {
            expect(toPlain(123)).toBe(123)
            expect(toPlain(null)).toBeNull()
        })

        it('should handle arrays recursively', () => {
            const arr = [{ $oid: '123' }, { $date: 1672531200000 }]
            const result = toPlain(arr) as any[]
            expect(Array.isArray(result)).toBe(true)
            expect(result[0]).toBe('123')
            expect(result[1]).toBeInstanceOf(Date)
        })

        it('should handle objects recursively', () => {
            const obj = { user: { $oid: '123' }, status: 'active' }
            const result = toPlain(obj) as any
            expect(result.user).toBe('123')
            expect(result.status).toBe('active')
        })

        it('should ignore inherited enumerable properties', () => {
            const proto = { inherited: { $oid: 'skip-me' } }
            const input = Object.create(proto) as Record<string, unknown>
            input.own = { $oid: 'keep-me' }

            expect(toPlain(input)).toEqual({ own: 'keep-me' })
        })
    })

    describe('extractId', () => {
        it('should return string if input is string', () => {
            expect(extractId('123')).toBe('123')
        })

        it('should extract $oid', () => {
            expect(extractId({ $oid: 'abc' })).toBe('abc')
        })

        it('should extract id property', () => {
            expect(extractId({ id: 'def' })).toBe('def')
        })

        it('should extract from _id property recursively', () => {
            expect(extractId({ _id: 'ghi' })).toBe('ghi')
            expect(extractId({ _id: { $oid: 'jkl' } })).toBe('jkl')
        })

        it('should extract from toHexString', () => {
            const obj = { toHexString: () => 'hex-id' }
            expect(extractId(obj)).toBe('hex-id')
        })

        it('should return undefined if no ID found or falsy', () => {
            expect(extractId(null)).toBeUndefined()
            expect(extractId({})).toBeUndefined()
            expect(extractId({ id: 123 })).toBeUndefined() // not a string
        })

        it('should extract from custom toString', () => {
            const obj = { toString: () => 'custom-id' }
            expect(extractId(obj)).toBe('custom-id')
        })

        it('should return undefined if toString returns [object Object]', () => {
            const obj = { toString: () => '[object Object]' }
            expect(extractId(obj)).toBeUndefined()
        })

        it('should handle objects without toString', () => {
            const obj = Object.create(null)
            expect(extractId(obj)).toBeUndefined()
        })

        it('should return undefined for truthy non-object values', () => {
            expect(extractId(123)).toBeUndefined()
        })
    })
})









