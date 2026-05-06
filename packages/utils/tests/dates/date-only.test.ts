import { describe, it, expect, vi } from 'vitest'
import {
    dateStringToDateOnly,
    dateOnlyToDateString,
    dateToDateOnly,
    dateOnlyToDate,
    dateStringToDate,
    dateToDateString,
    formatDateOnly,
    formatDateString
} from '@src/dates/date-only.js'

describe('DateOnly Utilities', () => {
    describe('dateStringToDateOnly', () => {
        it('should convert ISO date-only string to DateOnly object', () => {
            expect(dateStringToDateOnly('1990-02-15')).toEqual({ year: 1990, month: 2, day: 15 })
        })

        it('should return undefined for invalid length', () => {
            expect(dateStringToDateOnly('1990-02')).toBeUndefined()
        })

        it('should return undefined for non-numeric strings', () => {
            expect(dateStringToDateOnly('aaaa-bb-cc')).toBeUndefined()
        })

        it('should return undefined for invalid dates', () => {
            expect(dateStringToDateOnly('1990-02-32')).toBeUndefined()
            expect(dateStringToDateOnly('1990-13-15')).toBeUndefined()
            expect(dateStringToDateOnly('1899-02-15')).toBeUndefined()
            expect(dateStringToDateOnly('1990-02-30')).toBeUndefined()
        })

        it('should return undefined when numeric parsing fails unexpectedly', () => {
            const parseIntSpy = vi.spyOn(globalThis, 'parseInt').mockReturnValueOnce(Number.NaN)
            expect(dateStringToDateOnly('1990-02-15')).toBeUndefined()
            parseIntSpy.mockRestore()
        })
    })

    describe('dateOnlyToDateString', () => {
        it('should convert DateOnly object to ISO date-only string', () => {
            expect(dateOnlyToDateString({ year: 1990, month: 2, day: 15 })).toBe('1990-02-15')
        })

        it('should pad single digits with zero', () => {
            expect(dateOnlyToDateString({ year: 1990, month: 1, day: 1 })).toBe('1990-01-01')
        })
    })

    describe('dateToDateOnly', () => {
        it('should convert Date object to DateOnly object', () => {
            const d = new Date(1990, 1, 15)
            expect(dateToDateOnly(d)).toEqual({ year: 1990, month: 2, day: 15 })
        })
    })

    describe('dateOnlyToDate', () => {
        it('should convert DateOnly object to Date object at midnight', () => {
            const result = dateOnlyToDate({ year: 1990, month: 2, day: 15 })
            expect(result.getFullYear()).toBe(1990)
            expect(result.getMonth()).toBe(1)
            expect(result.getDate()).toBe(15)
            expect(result.getHours()).toBe(0)
        })
    })

    describe('dateStringToDate', () => {
        it('should convert ISO date-only string to Date object', () => {
            const result = dateStringToDate('1990-02-15')
            expect(result?.getFullYear()).toBe(1990)
            expect(result?.getMonth()).toBe(1)
            expect(result?.getDate()).toBe(15)
        })

        it('should return undefined for invalid string', () => {
            expect(dateStringToDate('invalid')).toBeUndefined()
        })
    })

    describe('dateToDateString', () => {
        it('should convert Date object to ISO date-only string', () => {
            const d = new Date(1990, 1, 15)
            expect(dateToDateString(d)).toBe('1990-02-15')
        })
    })

    describe('formatDateOnly', () => {
        it('should format DateOnly object as canonical ISO date-only string', () => {
            expect(formatDateOnly({ year: 1990, month: 2, day: 15 })).toBe('1990-02-15')
        })
    })

    describe('formatDateString', () => {
        it('should format ISO date-only string as canonical ISO date-only string', () => {
            expect(formatDateString('1990-02-15')).toBe('1990-02-15')
        })

        it('should return empty string for invalid input', () => {
            expect(formatDateString('invalid')).toBe('')
        })
    })
})
