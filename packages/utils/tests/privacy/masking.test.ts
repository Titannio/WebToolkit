import { describe, it, expect } from 'vitest'
import { maskSensitiveData } from '@src/privacy/masking.js'

describe('Security Utils', () => {
    describe('maskSensitiveData', () => {
        it('should mask email addresses', () => {
            expect(maskSensitiveData('john.doe@example.com', 'EMAIL')).toBe('jo***@example.com')
            expect(maskSensitiveData('a@b.com', 'EMAIL')).toBe('a***@b.com')
            expect(maskSensitiveData('invalidemail', 'EMAIL')).toBe('invalidemail')
        })

        it('should mask phone numbers', () => {
            expect(maskSensitiveData('11999998888', 'PHONE')).toBe('11*****8888')
            expect(maskSensitiveData('1188887777', 'PHONE')).toBe('11****7777')
            expect(maskSensitiveData('+14155552671', 'PHONE')).toBe('+14*****2671')
            expect(maskSensitiveData('123', 'PHONE')).toBe('123')
        })

        it('should return original text if invalid type', () => {
            // @ts-expect-error - testing runtime safety for unknown type
            expect(maskSensitiveData('test', 'UNKNOWN')).toBe('test')
        })

        it('should return empty string for empty input', () => {
            expect(maskSensitiveData('', 'EMAIL')).toBe('')
            expect(maskSensitiveData(null as any, 'EMAIL')).toBe('')
        })
    })
})









