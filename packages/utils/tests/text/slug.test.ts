import { describe, expect, it } from 'vitest'

import { toSlug } from '@src/text/slug.js'

describe('slug utils', () => {
  it('normalizes text into URL-friendly slugs', () => {
    expect(toSlug('François Müller Smith')).toBe('francois-muller-smith')
    expect(toSlug('Renée Élise Dubois')).toBe('renee-elise-dubois')
    expect(toSlug('Dr. Chloë Smith')).toBe('dr-chloe-smith')
  })

  it('collapses whitespace and punctuation', () => {
    expect(toSlug('Renée  Dubois')).toBe('renee-dubois')
    expect(toSlug('François (Müller) Smith!')).toBe('francois-muller-smith')
    expect(toSlug('Chloë Smith 2')).toBe('chloe-smith-2')
    expect(toSlug('Alice@Smith#2024')).toBe('alice-smith-2024')
  })

  it('returns an empty string when no slug token remains', () => {
    expect(toSlug('')).toBe('')
    expect(toSlug('   ')).toBe('')
    expect(toSlug('!!!')).toBe('')
  })
})
