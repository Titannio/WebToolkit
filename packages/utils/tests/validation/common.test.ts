import { describe, it, expect } from 'vitest'
import {
    validateBirthDate,
    validateEmail,
    validateDate,
    validateNumber
} from '@src/validation/common.js'

describe('Validations Utils', () => {
    describe('validateEmail', () => {
        it('should validate standard email', () => {
            expect(validateEmail('test@example.com')).toBe(true)
        })

        it('should return false for invalid email', () => {
            expect(validateEmail('test@')).toBe(false)
            expect(validateEmail('test@example')).toBe(false)
            expect(validateEmail('test.com')).toBe(false)
        })
    })

    describe('validateDate', () => {
        it('should validate Date object and string', () => {
            expect(validateDate(new Date())).toBe(true)
            expect(validateDate('2023-01-01')).toBe(true)
        })

        it('should return false for invalid date', () => {
            expect(validateDate('invalid')).toBe(false)
            expect(validateDate(null as any)).toBe(false)
        })
    })

    describe('validateBirthDate', () => {
        it('should validate adult birth date', () => {
            const date = new Date()
            date.setFullYear(date.getFullYear() - 20)
            expect(validateBirthDate(date)).toBe(true)
        })

        it('should return false for child birth date', () => {
            const date = new Date()
            date.setFullYear(date.getFullYear() - 10)
            expect(validateBirthDate(date)).toBe(false)
        })

        it('should reject ambiguous string input without explicit format', () => {
            expect(validateBirthDate('01/01/1990')).toBe(false)
            expect(validateBirthDate('01011990')).toBe(false)
        })

        it('should handle different formats (MDY, YMD)', () => {
            expect(validateBirthDate('31/08/1992', 18, 'DMY')).toBe(true)
            expect(validateBirthDate('12/31/1990', 18, 'MDY')).toBe(true)
            expect(validateBirthDate('19901231', 18, 'YMD')).toBe(true)
        })

        it('should handle ISO string with hyphens', () => {
            expect(validateBirthDate('1990-12-31')).toBe(true)
        })

        it('should handle birthday being today (nearly adult)', () => {
            const date = new Date()
            date.setFullYear(date.getFullYear() - 18)
            // If today is his birthday, he IS 18.
            expect(validateBirthDate(date)).toBe(true)

            // If tomorrow is his birthday, he is 17.
            const tomorrow = new Date(date)
            tomorrow.setDate(tomorrow.getDate() + 1)
            expect(validateBirthDate(tomorrow)).toBe(false)
        })

        it('should return false for invalid string date', () => {
            expect(validateBirthDate('invalid')).toBe(false)
        })

        it('should handle numeric birth date (timestamp)', () => {
            const eighteenYearsAgo = new Date()
            eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 20)
            expect(validateBirthDate(eighteenYearsAgo.getTime())).toBe(true)
        })

        it('should return false for semantically invalid date (e.g. Feb 31st)', () => {
            expect(validateBirthDate('31/02/1990')).toBe(false)
        })

        it('should return false for invalid formatted values after explicit parsing', () => {
            expect(validateBirthDate('31/02/1990', 18, 'DMY')).toBe(false)
            expect(validateBirthDate('123', 18, 'DMY')).toBe(false)
        })

        it('should return false for future date (this year)', () => {
            const date = new Date()
            date.setDate(date.getDate() + 1)
            // If tomorrow is still this year, it hits line 50
            if (date.getFullYear() === new Date().getFullYear()) {
                expect(validateBirthDate(date)).toBe(false)
            }
        })

        it('should validate numeric birth date (timestamp)', () => {
            const timestamp = new Date(2000, 0, 1).getTime()
            expect(validateBirthDate(timestamp)).toBe(true)
        })

        it('should return false for invalid date string length', () => {
            expect(validateBirthDate('123')).toBe(false)
        })

        it('should return false for invalid Date objects', () => {
            expect(validateBirthDate(new Date('invalid'))).toBe(false)
        })

        it('should return false for falsy input', () => {
            expect(validateBirthDate(null as any)).toBe(false)
            expect(validateBirthDate(undefined as any)).toBe(false)
        })
    })

    describe('validateNumber', () => {
        it('should validate correctly based on pattern', () => {
            expect(validateNumber('123', /^\d{3}$/)).toBe(true)
            expect(validateNumber('abc', /^\d{3}$/)).toBe(false)
        })

        it('should return false for falsy input', () => {
            expect(validateNumber('', /^\d{3}$/)).toBe(false)
        })
    })
})









