import { describe, it, expect } from 'vitest'
import { BRAZILIAN_STATES } from '@src/countries/BR/brazilian.types.js'

describe('brazilian types', () => {
  it('should include SP and total count of 27', () => {
    expect(BRAZILIAN_STATES).toContain('SP')
    expect(BRAZILIAN_STATES.length).toBe(27)
  })
})
