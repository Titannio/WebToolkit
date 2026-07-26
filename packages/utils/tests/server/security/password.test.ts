import { describe, expect, it } from 'vitest'
import { generateRandomPassword } from '@src/server/security/password.js'
import { extractBearerToken, timingSafeEqualStrings } from '@src/server/security/index.js'

describe('server/password', () => {
  it('should preserve the default 10-character alphanumeric contract', () => {
    const password = generateRandomPassword()

    expect(password).toHaveLength(10)
    expect(password).toMatch(/[A-Z]/)
    expect(password).toMatch(/[a-z]/)
    expect(password).toMatch(/[0-9]/)
    expect(password).toMatch(/^[A-Za-z0-9]+$/)
  })

  it('should honor custom length and minimum composition', () => {
    for (let index = 0; index < 50; index += 1) {
      const password = generateRandomPassword({
        length: 16,
        minUppercase: 2,
        minLowercase: 3,
        minDigits: 4,
        minSymbols: 2,
      })

      expect(password).toHaveLength(16)
      expect(password.match(/[A-Z]/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
      expect(password.match(/[a-z]/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
      expect(password.match(/[0-9]/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
      expect(password.match(/[^A-Za-z0-9]/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    }
  })

  it('should include symbols in filler alphabet when requested', () => {
    const passwords = Array.from({ length: 100 }, () =>
      generateRandomPassword({ length: 20, includeSymbols: true, symbolChars: '!' })
    )

    expect(passwords.some((password) => password.includes('!'))).toBe(true)
  })

  it('should reject impossible or invalid options', () => {
    expect(() => generateRandomPassword({ length: 2, minUppercase: 1, minLowercase: 1, minDigits: 1 }))
      .toThrow('minimum character counts cannot exceed password length')
    expect(() => generateRandomPassword({ length: 0 })).toThrow('length must be a positive integer')
    expect(() => generateRandomPassword({ minDigits: -1 })).toThrow('minimum character counts')
    expect(() => generateRandomPassword({ symbolChars: '' })).toThrow('symbolChars must not be empty')
  })
})

describe('server/security', () => {
  it('extracts only valid Bearer tokens', () => {
    expect(extractBearerToken('Bearer token-value')).toBe('token-value')
    expect(extractBearerToken('  bearer   token-value  ')).toBe('token-value')
    expect(extractBearerToken('Basic token-value')).toBeNull()
    expect(extractBearerToken('Bearer token value')).toBeNull()
    expect(extractBearerToken('Bearer ')).toBeNull()
    expect(extractBearerToken(undefined)).toBeNull()
  })

  it('compares equal, different-length, and Unicode strings safely', () => {
    expect(timingSafeEqualStrings('secret', 'secret')).toBe(true)
    expect(timingSafeEqualStrings('secret', 'different-length-secret')).toBe(false)
    expect(timingSafeEqualStrings('segredo-ç', 'segredo-ç')).toBe(true)
    expect(timingSafeEqualStrings('segredo-ç', 'segredo-c')).toBe(false)
  })
})
