import { describe, expect, it } from 'vitest'

import { toSlug } from '@src/text/slug.js'

describe('slug utils', () => {
  it('normalizes text into URL-friendly slugs', () => {
    expect(toSlug('João Silva Santos')).toBe('joao-silva-santos')
    expect(toSlug('Maria José da Silva')).toBe('maria-jose-da-silva')
    expect(toSlug('Dr. Pedro Álvares')).toBe('dr-pedro-alvares')
  })

  it('collapses whitespace and punctuation', () => {
    expect(toSlug('Maria  José')).toBe('maria-jose')
    expect(toSlug('João (Silva) Santos!')).toBe('joao-silva-santos')
    expect(toSlug('João Silva 2')).toBe('joao-silva-2')
  })

  it('returns an empty string when no slug token remains', () => {
    expect(toSlug('')).toBe('')
    expect(toSlug('   ')).toBe('')
    expect(toSlug('!!!')).toBe('')
  })
})
