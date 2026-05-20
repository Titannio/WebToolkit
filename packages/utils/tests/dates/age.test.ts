import { describe, expect, it } from 'vitest'

import { getAgeFromDate, isAtLeastAge, parseCivilDate } from '@src/dates/age.js'

describe('age utils', () => {
  it('parses ISO civil dates', () => {
    expect(parseCivilDate('2008-05-10')).toEqual({ year: 2008, month: 5, day: 10 })
    expect(parseCivilDate('2008-05-10T00:00:00.000Z')).toEqual({ year: 2008, month: 5, day: 10 })
  })

  it('parses localized strings when an explicit format is provided', () => {
    expect(parseCivilDate('10/05/2008', 'DMY')).toEqual({ year: 2008, month: 5, day: 10 })
    expect(parseCivilDate('05/10/2008', 'MDY')).toEqual({ year: 2008, month: 5, day: 10 })
    expect(parseCivilDate('20080510', 'YMD')).toEqual({ year: 2008, month: 5, day: 10 })
  })

  it('returns null for invalid civil dates', () => {
    expect(parseCivilDate('2008-02-30')).toBeNull()
    expect(parseCivilDate('invalid')).toBeNull()
    expect(parseCivilDate('10/05/2008')).toBeNull()
  })

  it('calculates age from civil dates', () => {
    const referenceDate = new Date('2026-05-20T12:00:00.000Z')

    expect(getAgeFromDate('2008-05-10', referenceDate)).toBe(18)
    expect(getAgeFromDate('2008-05-21', referenceDate)).toBe(17)
    expect(getAgeFromDate('10/05/2008', referenceDate, 'DMY')).toBe(18)
  })

  it('returns null for future or invalid age inputs', () => {
    const referenceDate = new Date('2026-05-20T12:00:00.000Z')

    expect(getAgeFromDate('2027-01-01', referenceDate)).toBeNull()
    expect(getAgeFromDate('invalid', referenceDate)).toBeNull()
  })

  it('checks minimum age thresholds', () => {
    const referenceDate = new Date('2026-05-20T12:00:00.000Z')

    expect(isAtLeastAge('2008-05-20', 18, referenceDate)).toBe(true)
    expect(isAtLeastAge('2008-05-21', 18, referenceDate)).toBe(false)
  })
})
