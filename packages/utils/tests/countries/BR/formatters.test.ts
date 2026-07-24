import { describe, it, expect } from 'vitest'
import { formatDate, maskBRDate, maskCPF, maskDocument, maskPhoneBR } from '@src/countries/BR/formatters.js'

describe('Formatters Utils', () => {
  describe('maskCPF', () => {
    it('should mask CPF progressively', () => {
      expect(maskCPF('123')).toBe('123')
      expect(maskCPF('123456')).toBe('123.456')
      expect(maskCPF('123456789')).toBe('123.456.789')
      expect(maskCPF('12345678901')).toBe('123.456.789-01')
    })
  })

  describe('maskDocument', () => {
    it('should use maskCPF', () => {
      expect(maskDocument('12345678901')).toBe('123.456.789-01')
    })
  })

  describe('maskBRDate', () => {
    it('should format Date object', () => {
      const date = new Date(2023, 0, 1) // Jan 1st 2023
      expect(maskBRDate(date)).toBe('01/01/2023')
    })

    it('should format string progressively', () => {
      expect(maskBRDate('')).toBe('')
      expect(maskBRDate('0')).toBe('0')
      expect(maskBRDate('01')).toBe('01')
      expect(maskBRDate('010')).toBe('01/0')
      expect(maskBRDate('0101')).toBe('01/01')
      expect(maskBRDate('01012')).toBe('01/01/2')
      expect(maskBRDate('01012023')).toBe('01/01/2023')
    })

    it('should handle partial numeric strings', () => {
      expect(maskBRDate('1')).toBe('1')
      expect(maskBRDate('123')).toBe('12/3')
      expect(maskBRDate('12345')).toBe('12/34/5')
    })

    it('should return empty string for null/undefined', () => {
      expect(maskBRDate(null as any)).toBe('')
      expect(maskBRDate(undefined as any)).toBe('')
    })

    it('should handle string with no digits', () => {
      expect(maskBRDate('abc')).toBe('')
    })
  })

  describe('formatDate', () => {
    it('should format date to dd/MM/yyyy', () => {
      const date = new Date(2023, 5, 15)
      expect(formatDate(date)).toBe('15/06/2023')
    })

    it('should handle Date object', () => {
      const date = new Date(2023, 0, 1)
      expect(formatDate(date)).toBe('01/01/2023')
    })

    it('should return empty string for invalid dates', () => {
      expect(formatDate('invalid')).toBe('')
      expect(formatDate(0 as any)).toBe('')
    })

    it('should handle ISO date strings', () => {
      expect(formatDate('2023-06-15')).toBe('15/06/2023')
    })

    it('should handle non-ISO but valid date strings', () => {
      expect(formatDate('2023/06/15')).toBe('15/06/2023')
    })

    it('should handle numeric date inputs (timestamps)', () => {
      const timestamp = new Date(2023, 5, 15).getTime()
      expect(formatDate(timestamp)).toBe('15/06/2023')
    })
  })

  describe('maskPhoneBR', () => {
    it('should mask phone progressively', () => {
      expect(maskPhoneBR('')).toBe('')
      expect(maskPhoneBR('1')).toBe('(1')
      expect(maskPhoneBR('11')).toBe('(11')
      expect(maskPhoneBR('119')).toBe('(11) 9')
      expect(maskPhoneBR('119876')).toBe('(11) 9876')
      expect(maskPhoneBR('1198765')).toBe('(11) 9876-5')
      expect(maskPhoneBR('1198765432')).toBe('(11) 9876-5432')
      expect(maskPhoneBR('11987654321')).toBe('(11) 98765-4321')
    })

    it('should not normalize leading zero from three-digit DDD', () => {
      expect(maskPhoneBR('021999999999')).toBe('(02) 19999-9999')
      expect(maskPhoneBR('(043) 3333-4444')).toBe('(04) 33333-4444')
    })

    it('should not normalize Brazil DDI prefixes', () => {
      expect(maskPhoneBR('+55 (21) 99999-9999')).toBe('(55) 21999-9999')
      expect(maskPhoneBR('55 043 3333-4444')).toBe('(55) 04333-3344')
      expect(maskPhoneBR('05521999999999')).toBe('(05) 52199-9999')
    })

    it('should return empty string for null/undefined', () => {
      expect(maskPhoneBR(null as any)).toBe('')
      expect(maskPhoneBR(undefined as any)).toBe('')
    })

    it('should return empty string for string with no digits', () => {
      expect(maskPhoneBR('abc')).toBe('')
    })
  })
})
