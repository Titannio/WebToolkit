import { describe, it, expect } from 'vitest'
import {
  toDate,
  isPast,
  isFuture,
  isValidBirthDate,
  addDays,
  addMonths,
  diffDays,
  toISODate,
  calculateAhead,
  toStartOfDay,
  toEndOfDay,
  isOverlapping,
  parseTimeToMinutes,
  minutesToTime,
  isLocalDate,
  addDaysToLocalDate,
  zonedLocalDateTimeToUtc,
  getCurrentMonthValue,
  addMonthsToMonthValue,
  getMaxMonthValue,
  isMonthBeyondHorizon,
  isLocalDateBeyondMonthHorizon,
} from '@src/dates/date.js'

describe('Date Utilities', () => {
  describe('parseTimeToMinutes', () => {
    it('should convert HH:mm to total minutes', () => {
      expect(parseTimeToMinutes('08:30')).toBe(510)
      expect(parseTimeToMinutes('00:00')).toBe(0)
      expect(parseTimeToMinutes('23:59')).toBe(1439)
    })
  })

  describe('civil date and time helpers', () => {
    it('should convert minutes to HH:mm', () => {
      expect(minutesToTime(0)).toBe('00:00')
      expect(minutesToTime(510)).toBe('08:30')
      expect(minutesToTime(1439)).toBe('23:59')
    })

    it('should validate local date strings', () => {
      expect(isLocalDate('2026-06-01')).toBe(true)
      expect(isLocalDate('2026-02-30')).toBe(false)
      expect(isLocalDate('2026-6-1')).toBe(false)
      expect(isLocalDate(undefined)).toBe(false)
    })

    it('should add civil days to local date strings', () => {
      expect(addDaysToLocalDate('2026-06-01', 1)).toBe('2026-06-02')
      expect(addDaysToLocalDate('2026-12-31', 1)).toBe('2027-01-01')
      expect(addDaysToLocalDate('2026-01-01', -1)).toBe('2025-12-31')
    })

    it('should convert zoned local date times to UTC instants', () => {
      expect(zonedLocalDateTimeToUtc('2026-06-01', '00:00', 'America/Sao_Paulo').toISOString()).toBe('2026-06-01T03:00:00.000Z')
      expect(zonedLocalDateTimeToUtc('2026-06-01', '00:00', 'America/New_York').toISOString()).toBe('2026-06-01T04:00:00.000Z')
    })

    it('should handle timezone-aware month horizons', () => {
      const now = new Date('2026-12-31T23:30:00.000Z')
      expect(getCurrentMonthValue('UTC', now)).toBe('2026-12')
      expect(getCurrentMonthValue('Pacific/Kiritimati', now)).toBe('2027-01')
      expect(addMonthsToMonthValue('2026-12', 2)).toBe('2027-02')
      expect(getMaxMonthValue(2, 'UTC', now)).toBe('2027-02')
      expect(isMonthBeyondHorizon('2027-03', 2, 'UTC', now)).toBe(true)
      expect(isLocalDateBeyondMonthHorizon('2027-02-28', 2, 'UTC', now)).toBe(false)
    })
  })

  describe('calculateAhead', () => {
    it('should calculate date ahead correctly', () => {
      const base = new Date(2023, 0, 1) // Jan 1st
      const result = calculateAhead(1, base)
      expect(result.getMonth()).toBe(1) // Feb
      expect(result.getFullYear()).toBe(2023)
      expect(result.getHours()).toBe(23)
      expect(result.getMinutes()).toBe(59)
    })

    it('should use current date if base is not provided', () => {
      const result = calculateAhead(1)
      const expected = new Date()
      expected.setMonth(expected.getMonth() + 1)
      expect(result.getMonth()).toBe(expected.getMonth())
    })
  })

  describe('toStartOfDay', () => {
    it('should normalize to start of day', () => {
      const d = new Date(2023, 0, 1, 15, 30, 0)
      const result = toStartOfDay(d)
      expect(result?.getHours()).toBe(0)
      expect(result?.getMinutes()).toBe(0)
      expect(result?.getSeconds()).toBe(0)
      expect(result?.getMilliseconds()).toBe(0)
    })
    it('should return undefined for invalid input', () => {
      expect(toStartOfDay(null as any)).toBeUndefined()
    })
  })

  describe('toEndOfDay', () => {
    it('should normalize to end of day', () => {
      const d = new Date(2023, 0, 1, 15, 30, 0)
      const result = toEndOfDay(d)
      expect(result?.getHours()).toBe(23)
      expect(result?.getMinutes()).toBe(59)
      expect(result?.getSeconds()).toBe(59)
      expect(result?.getMilliseconds()).toBe(999)
    })
    it('should return undefined for invalid input', () => {
      expect(toEndOfDay(null as any)).toBeUndefined()
    })
  })

  describe('isOverlapping', () => {
    it('should detect overlap', () => {
      const a = { startDate: new Date(2023, 0, 1), endDate: new Date(2023, 0, 10) }
      const b = { startDate: new Date(2023, 0, 5), endDate: new Date(2023, 0, 15) }
      expect(isOverlapping(a, b)).toBe(true)
    })
    it('should return false for no overlap', () => {
      const a = { startDate: new Date(2023, 0, 1), endDate: new Date(2023, 0, 5) }
      const b = { startDate: new Date(2023, 0, 6), endDate: new Date(2023, 0, 10) }
      expect(isOverlapping(a, b)).toBe(false)
    })
    it('should return false for invalid range inputs', () => {
      const a = { startDate: null as any, endDate: new Date() }
      const b = { startDate: new Date(), endDate: new Date() }
      expect(isOverlapping(a, b)).toBe(false)
    })
  })
  
  // ... (previous tests kept intact)

  describe('toDate', () => {
    it('should return undefined for null or undefined', () => {
      expect(toDate(null)).toBeUndefined()
      expect(toDate(undefined)).toBeUndefined()
    })

    it('should return the same date if valid', () => {
      const d = new Date()
      expect(toDate(d)).toBe(d)
    })

    it('should return undefined for invalid date object', () => {
      expect(toDate(new Date('invalid'))).toBeUndefined()
    })

    it('should parse ISO strings', () => {
      const s = '2023-01-01T10:00:00Z'
      const d = toDate(s)
      expect(d).toBeInstanceOf(Date)
      expect(d?.toISOString()).toBe(new Date(s).toISOString())
    })

    it('should reject ambiguous compact strings', () => {
      expect(toDate('15022023')).toBeUndefined()
    })

    it('should parse simple YYYY-MM-DD strings', () => {
      const s = '2023-05-20'
      const d = toDate(s)
      expect(d?.getDate()).toBe(20)
      expect(d?.getMonth()).toBe(4) // May
      expect(d?.getFullYear()).toBe(2023)
    })

    it('should parse numbers as timestamps', () => {
      const ts = 1672531200000
      const d = toDate(ts)
      expect(d?.getTime()).toBe(ts)
    })

    it('should return undefined for invalid numbers', () => {
      expect(toDate(NaN)).toBeUndefined()
    })

    it('should return undefined for unsupported non-ISO strings', () => {
      expect(toDate('00000000')).toBeUndefined()
      expect(toDate('15/02/2023')).toBeUndefined()
    })

    it('should return undefined for invalid ISO-like strings', () => {
      expect(toDate('2023-99-99')).toBeUndefined()
    })

    it('should return undefined for invalid full ISO datetime strings', () => {
      expect(toDate('2023-01-01T99:00:00Z')).toBeUndefined()
    })

    it('should return undefined for unknown formats', () => {
      expect(toDate({} as any)).toBeUndefined()
      expect(toDate(true as any)).toBeUndefined()
    })
  })

  describe('isPast', () => {
    it('should return true for past date', () => {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 1)
      expect(isPast(d)).toBe(true)
    })

    it('should return false for future date', () => {
      const d = new Date()
      d.setFullYear(d.getFullYear() + 1)
      expect(isPast(d)).toBe(false)
    })

    it('should return false for invalid input', () => {
      expect(isPast(null as any)).toBe(false)
    })
  })

  describe('isFuture', () => {
    it('should return true for future date', () => {
      const d = new Date()
      d.setFullYear(d.getFullYear() + 1)
      expect(isFuture(d)).toBe(true)
    })

    it('should return false for past date', () => {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 1)
      expect(isFuture(d)).toBe(false)
    })

    it('should return false for invalid input', () => {
      expect(isFuture(null as any)).toBe(false)
    })
  })

  describe('isValidBirthDate', () => {
    it('should validate correct birth dates', () => {
      expect(isValidBirthDate(new Date(1990, 1, 15))).toBe(true)
      expect(isValidBirthDate('1990-02-15')).toBe(true)
      expect(isValidBirthDate('15/02/1990', 'DMY')).toBe(true)
    })

    it('should return false for invalid string input', () => {
      expect(isValidBirthDate('not-a-date')).toBe(false)
    })

    it('should return false for invalid date object input', () => {
      expect(isValidBirthDate(new Date('invalid'))).toBe(false)
    })

    it('should reject future birth dates', () => {
      const future = new Date()
      future.setFullYear(future.getFullYear() + 1)
      expect(isValidBirthDate(future)).toBe(false)
    })

    it('should reject very old birth dates', () => {
      expect(isValidBirthDate('1899-01-01')).toBe(false)
    })

    it('should reject invalid dates (Feb 30th)', () => {
      expect(isValidBirthDate('1990-02-30')).toBe(false)
    })

    it('should reject ambiguous localized strings', () => {
      expect(isValidBirthDate('15/02/1990')).toBe(false)
      expect(isValidBirthDate('15021990')).toBe(false)
    })

    it('should parse localized strings when explicit formats are provided', () => {
      expect(isValidBirthDate('12/31/1990', 'MDY')).toBe(true)
      expect(isValidBirthDate('19901231', 'YMD')).toBe(true)
    })

    it('should reject short localized strings even with explicit format', () => {
      expect(isValidBirthDate('123', 'DMY')).toBe(false)
    })

    it('should process numeric timestamps in birth-date validation', () => {
      expect(isValidBirthDate(new Date(1990, 1, 15).getTime())).toBe(true)
      expect(isValidBirthDate(Number.NaN)).toBe(false)
      expect(isValidBirthDate(Number.POSITIVE_INFINITY)).toBe(false)
    })

    it('should reject impossible month/day values coming from Date-like instances', () => {
      const invalidMonth = new Date(2000, 0, 1)
      Object.defineProperty(invalidMonth, 'getMonth', { value: () => 99 })
      expect(isValidBirthDate(invalidMonth)).toBe(false)

      const invalidDay = new Date(2000, 0, 1)
      Object.defineProperty(invalidDay, 'getDate', { value: () => 99 })
      expect(isValidBirthDate(invalidDay)).toBe(false)
    })

    it('should return false for null input', () => {
      expect(isValidBirthDate(null as any)).toBe(false)
    })
  })

  describe('addDays', () => {
    it('should add days correctly', () => {
      const base = new Date(2023, 0, 1)
      const result = addDays(base, 5)
      expect(result?.getDate()).toBe(6)
    })

    it('should subtract days correctly', () => {
      const base = new Date(2023, 0, 10)
      const result = addDays(base, -5)
      expect(result?.getDate()).toBe(5)
    })

    it('should return undefined for invalid base', () => {
      expect(addDays(null, 5)).toBeUndefined()
    })
  })

  describe('addMonths', () => {
    it('should add months correctly', () => {
      const base = new Date(2023, 0, 1)
      const result = addMonths(base, 1)
      expect(result?.getMonth()).toBe(1)
    })

    it('should subtract months correctly', () => {
      const base = new Date(2023, 5, 1)
      const result = addMonths(base, -1)
      expect(result?.getMonth()).toBe(4)
    })

    it('should return undefined for invalid input', () => {
      expect(addMonths(null, 1)).toBeUndefined()
    })
  })

  describe('diffDays', () => {
    it('should calculate difference correctly', () => {
      const d1 = new Date(2023, 0, 1)
      const d2 = new Date(2023, 0, 11)
      expect(diffDays(d1, d2)).toBe(10)
    })

    it('should return absolute difference', () => {
      const d1 = new Date(2023, 0, 11)
      const d2 = new Date(2023, 0, 1)
      expect(diffDays(d1, d2)).toBe(10)
    })

    it('should return undefined for invalid input', () => {
      expect(diffDays(null, new Date())).toBeUndefined()
    })
  })

  describe('toISODate', () => {
    it('should convert to ISO string', () => {
      const d = new Date(2023, 0, 1)
      expect(toISODate(d)).toBe(d.toISOString())
    })

    it('should return undefined for invalid input', () => {
      expect(toISODate(null)).toBeUndefined()
    })
  })
})
