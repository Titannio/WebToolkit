import { describe, expect, it } from 'vitest'
import {
  buildDigitPatternVariants,
  isBetterDigitPatternScore,
  scoreDigitPatternSuffix,
  type DigitPatternToken,
} from '@src/text/digit-patterns.js'

describe('text/digit-patterns', () => {
  describe('isBetterDigitPatternScore', () => {
    it('prioritizes exact matches first', () => {
      expect(
        isBetterDigitPatternScore(
          { exact: true, specificity: 0, gap: 0 },
          { exact: false, specificity: 10, gap: 0 },
        ),
      ).toBe(true)
    })

    it('prioritizes higher specificity when exactness is equal', () => {
      expect(
        isBetterDigitPatternScore(
          { exact: true, specificity: 2, gap: 1 },
          { exact: true, specificity: 1, gap: 0 },
        ),
      ).toBe(true)
    })

    it('uses lower gap as tie-breaker', () => {
      expect(
        isBetterDigitPatternScore(
          { exact: false, specificity: 2, gap: 1 },
          { exact: false, specificity: 2, gap: 2 },
        ),
      ).toBe(true)
    })
  })

  describe('scoreDigitPatternSuffix', () => {
    const exactDigit: DigitPatternToken = {
      matches: (digit) => digit === '1',
      specificity: 2,
    }
    const anyDigit: DigitPatternToken = {
      matches: (digit) => /\d/.test(digit),
      specificity: 0,
    }

    it('returns undefined for empty or oversized input', () => {
      expect(scoreDigitPatternSuffix('', [exactDigit])).toBeUndefined()
      expect(scoreDigitPatternSuffix('111', [exactDigit, exactDigit])).toBeUndefined()
    })

    it('returns undefined when a token does not match', () => {
      expect(scoreDigitPatternSuffix('2', [exactDigit])).toBeUndefined()
    })

    it('scores suffix matches with correct exactness and gap', () => {
      expect(scoreDigitPatternSuffix('1', [anyDigit, exactDigit])).toEqual({
        exact: false,
        specificity: 2,
        gap: 1,
      })
      expect(scoreDigitPatternSuffix('11', [exactDigit, exactDigit])).toEqual({
        exact: true,
        specificity: 4,
        gap: 0,
      })
    })
  })

  describe('buildDigitPatternVariants', () => {
    it('supports literal digits, char classes and digit wildcards', () => {
      const variants = buildDigitPatternVariants('^1[3-9]\\d$')
      expect(variants).toHaveLength(1)
      expect(variants[0]).toHaveLength(3)
      expect(variants[0]?.[0]?.matches('1')).toBe(true)
      expect(variants[0]?.[1]?.matches('5')).toBe(true)
      expect(variants[0]?.[2]?.matches('0')).toBe(true)
    })

    it('expands fixed and ranged quantifiers', () => {
      const fixed = buildDigitPatternVariants('^\\d{2}$')
      expect(fixed).toHaveLength(1)
      expect(fixed[0]).toHaveLength(2)

      const ranged = buildDigitPatternVariants('^\\d{1,2}$')
      expect(ranged).toHaveLength(2)
      expect(ranged[0]).toHaveLength(1)
      expect(ranged[1]).toHaveLength(2)
    })

    it('trims leading explicit country digits when requested', () => {
      const variants = buildDigitPatternVariants('^\\+55\\d{2}$', '55')
      expect(variants).toHaveLength(1)
      expect(variants[0]).toHaveLength(2)
    })

    it('throws for unsupported pattern tokens', () => {
      expect(() => buildDigitPatternVariants('^A$')).toThrow('Unsupported digit pattern token')
    })
  })
})
