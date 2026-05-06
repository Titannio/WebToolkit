import { describe, it, expect } from 'vitest'
import { calculateNetValue, formatCurrency, parseCurrency } from '@src/finance/currency.js'
import { BadRequestError } from '@src/core/errors.js'

describe('finance utils', () => {
    describe('calculateNetValue', () => {
        it('should calculate net value correctly', () => {
            expect(calculateNetValue(100, 10)).toBe(90)
            expect(calculateNetValue(100, 100)).toBe(0)
        })

        it('should return 0 if net value is negative', () => {
            expect(calculateNetValue(100, 110)).toBe(0)
        })

        it('should return 0 if amount is 0 or negative', () => {
            expect(calculateNetValue(0, 10)).toBe(0)
            expect(calculateNetValue(-10, 10)).toBe(0)
        })

        it('should throw BadRequestError for null or undefined values', () => {
            // @ts-expect-error - testing runtime safety for null
            expect(() => calculateNetValue(null, 10)).toThrow(BadRequestError)
            // @ts-expect-error - testing runtime safety for undefined
            expect(() => calculateNetValue(undefined, 10)).toThrow(BadRequestError)
            // @ts-expect-error - testing runtime safety for null fee
            expect(() => calculateNetValue(100, null)).toThrow(BadRequestError)
            // @ts-expect-error - testing runtime safety for undefined fee
            expect(() => calculateNetValue(100, undefined)).toThrow(BadRequestError)
        })
    })

    describe('formatCurrency', () => {
        it('should format numeric values as USD currency by default', () => {
            const formatted = formatCurrency(1234.56)
            expect(formatted).toMatch(/\$1,234\.56/)
        })

        it('should format string as USD currency', () => {
            expect(formatCurrency('1234.56')).toMatch(/\$1,234\.56/)
        })

        it('should throw BadRequestError for null or undefined', () => {
            expect(() => formatCurrency(null)).toThrow(BadRequestError)
            expect(() => formatCurrency(undefined)).toThrow(BadRequestError)
        })

        it('should throw BadRequestError for invalid numbers', () => {
            expect(() => formatCurrency('invalid')).toThrow(BadRequestError)
        })

        it('should handle zero value', () => {
            const formatted = formatCurrency(0)
            expect(formatted).toMatch(/\$0\.00/)
        })

        it('should format with custom currency and locale', () => {
            const formatted = formatCurrency(1234.56, { currency: 'EUR', locale: 'de-DE' })
            // de-DE uses dot for thousand and comma for decimal, with € at the end
            expect(formatted).toMatch(/1\.234,56\s?€/)
        })

        it('should support decimal style (no symbol)', () => {
            const result = formatCurrency(1234.56, { showSymbol: false })
            expect(result).toBe('1,234.56')
        })

        it('should support custom fraction digits explicitly', () => {
            const result = formatCurrency(10.5, { minimumFractionDigits: 3 })
            expect(result).toMatch(/\$10\.500/)
        })

        it('should handle large numbers', () => {
            expect(formatCurrency(1000000)).toMatch(/\$1,000,000\.00/)
        })

        it('should handle negative numbers', () => {
            expect(formatCurrency(-50.25)).toMatch(/-\$50\.25/)
        })

        it('should respect maximumFractionDigits', () => {
            expect(formatCurrency(10.1234, { maximumFractionDigits: 3 })).toMatch(/\$10\.123/)
        })
    })

    describe('parseCurrency', () => {
        it('should parse USD currency string by default', () => {
            expect(parseCurrency('$1,234.56')).toBe(1234.56)
            expect(parseCurrency('1234.56')).toBe(1234.56)
        })

        it('should parse negative values', () => {
            expect(parseCurrency('-$1,234.56')).toBe(-1234.56)
            expect(parseCurrency('-1234.56')).toBe(-1234.56)
        })

        it('should parse values with multiple separators', () => {
            expect(parseCurrency('1,234,567.89')).toBe(1234567.89)
        })

        it('should parse BRL currency string when locale is pt-BR', () => {
            expect(parseCurrency('1.234,56', 'pt-BR')).toBe(1234.56)
            expect(parseCurrency('R$ 1.234,56', 'pt-BR')).toBe(1234.56)
        })

        it('should throw BadRequestError for null, undefined or empty string', () => {
            expect(() => parseCurrency(null)).toThrow(BadRequestError)
            expect(() => parseCurrency(undefined)).toThrow(BadRequestError)
            expect(() => parseCurrency('')).toThrow(BadRequestError)
        })

        it('should throw BadRequestError for invalid numeric strings', () => {
            expect(() => parseCurrency('invalid')).toThrow(BadRequestError)
        })
    })
})
