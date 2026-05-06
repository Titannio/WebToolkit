import { describe, it, expect } from 'vitest'
import { genTimestampRandomSuffix, generateUniqueFilename, generateRandomString, randomSuffix } from '@src/random/generators.js'

describe('Generators Utils', () => {
    describe('genTimestampRandomSuffix', () => {
        it('should generate a string with timestamp and suffix', () => {
            const result = genTimestampRandomSuffix()
            expect(result).toMatch(/^\d{13}[a-z0-9]{5}$/)
        })

        it('should generate unique values', () => {
            const results = new Set(Array.from({ length: 100 }, () => genTimestampRandomSuffix()))
            expect(results.size).toBe(100)
        })
    })

    describe('generateUniqueFilename', () => {
        it('should generate a filename with prefix and extension', () => {
            const filename = generateUniqueFilename('test', 'txt')
            expect(filename).toMatch(/^test_\d{13}_[a-z0-9]{5}\.txt$/)
        })

        it('should handle extension starting with dot', () => {
            const filename = generateUniqueFilename('test', '.jpg')
            expect(filename).toMatch(/^test_\d{13}_[a-z0-9]{5}\.jpg$/)
        })

    })

    describe('generateRandomString', () => {
        it('should generate a string of the specified length', () => {
            const length = 10
            const result = generateRandomString(length)
            expect(result).toHaveLength(length)
        })

        it('should generate a string with default options (alphanumeric)', () => {
            const result = generateRandomString(100)
            expect(result).toMatch(/^[A-Za-z0-9]+$/)
        })

        it('should include only numbers when requested', () => {
            const result = generateRandomString(100, {
                upperCase: false,
                lowerCase: false,
                numbers: true,
                special: false
            })
            expect(result).toMatch(/^[0-9]+$/)
        })

        it('should include special characters when requested', () => {
            const result = generateRandomString(100, {
                upperCase: false,
                lowerCase: false,
                numbers: false,
                special: true
            })
            expect(result).toMatch(/^[!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/)
        })

        it('should throw an error if no character sets are selected', () => {
            expect(() => {
                generateRandomString(10, {
                    upperCase: false,
                    lowerCase: false,
                    numbers: false,
                    special: false
                })
            }).toThrow('At least one character set must be selected for random string generation.')
        })
    })

    describe('randomSuffix', () => {
        it('should generate an alphanumeric suffix of default length 5', () => {
            const result = randomSuffix()
            expect(result).toHaveLength(5)
            expect(result).toMatch(/^[a-z0-9]+$/)
        })
    })
})









