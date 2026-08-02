import { describe, it, expect } from 'vitest'
import { formatPercentRatio, parseFiniteNumberInput } from '@src/numbers/math.js'

describe('Math Utils', () => {
    describe('formatPercentRatio', () => {
        it('should format simple ratio as percentage', () => {
            expect(formatPercentRatio(12, 100)).toBe('12.00%')
        })

        it('should handle custom digits', () => {
            expect(formatPercentRatio(1, 3, 4)).toBe('33.3333%')
        })

        it('should handle zero denominator', () => {
            expect(formatPercentRatio(10, 0)).toBe('0.00%')
        })

        it('should handle zero numerator', () => {
            expect(formatPercentRatio(0, 50)).toBe('0.00%')
        })

        it('should handle invalid inputs', () => {
            expect(formatPercentRatio(NaN, 100)).toBe('0.00%')
            expect(formatPercentRatio(50, Infinity as any)).toBe('0.00%')
            expect(formatPercentRatio(undefined, undefined)).toBe('0.00%')
        })
    })
})

describe('parseFiniteNumberInput', () => {
    it('rejects blank and non-finite values', () => {
        expect(parseFiniteNumberInput('')).toBeNull()
        expect(parseFiniteNumberInput('   ')).toBeNull()
        expect(parseFiniteNumberInput('abc')).toBeNull()
        expect(parseFiniteNumberInput(NaN)).toBeNull()
        expect(parseFiniteNumberInput(Infinity)).toBeNull()
    })

    it('converts finite numeric drafts', () => {
        expect(parseFiniteNumberInput(0)).toBe(0)
        expect(parseFiniteNumberInput('-12')).toBe(-12)
        expect(parseFiniteNumberInput('12.5')).toBe(12.5)
    })
})









