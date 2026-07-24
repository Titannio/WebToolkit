import { describe, expect, it } from 'vitest'
import {
  buildDiacriticInsensitiveRegex,
  escapeRegex,
  normalizeSearchText,
  tokenizeForPrefixSearch,
} from '@src/search/text.js'

describe('search/text', () => {
  it('normalizes accents, casing and extra spaces', () => {
    expect(normalizeSearchText('  San   JOSÉ  ')).toBe('san jose')
  })

  it('returns empty string for nullish input', () => {
    expect(normalizeSearchText(null)).toBe('')
    expect(normalizeSearchText(undefined)).toBe('')
  })

  it('tokenizes without duplicates for prefix search', () => {
    expect(tokenizeForPrefixSearch('Cardio Cardio Clinic')).toEqual(['cardio', 'clinic'])
  })

  it('returns an empty token list for nullish text', () => {
    expect(tokenizeForPrefixSearch(null)).toEqual([])
  })

  it('escapes regex metacharacters', () => {
    expect(escapeRegex('john+amy.(test)')).toBe('john\\+amy\\.\\(test\\)')
  })

  it('builds an accent-insensitive regex', () => {
    const regex = buildDiacriticInsensitiveRegex('caf')
    expect(regex.test('Café')).toBe(true)
    expect(regex.test('caf')).toBe(true)
    expect(regex.test('sol')).toBe(false)
  })

  it('returns a never-match regex for empty search values', () => {
    const regex = buildDiacriticInsensitiveRegex('')
    expect(regex.test('anything')).toBe(false)
  })

  it('supports spaces as flexible whitespace in generated patterns', () => {
    const regex = buildDiacriticInsensitiveRegex('san jose')
    expect(regex.test('San     José')).toBe(true)
  })
})
