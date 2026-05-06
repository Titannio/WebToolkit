import { describe, it, expect } from 'vitest'
import {
  normalizeDigits,
  formatCPF,
  formatCNPJ,
  formatCEP,
  normalizeBrazilPhoneDigits,
  isValidCEP,
  formatPhone,
  formatPhoneForDisplay,
  isValidCPF,
  isValidCNPJ,
} from '@src/countries/BR/brazilian-documents.js'
import { isValidBirthDate } from '@src/dates/date.js'

describe('Brazilian Documents Utils', () => {
  describe('normalizeDigits', () => {
    it('should remove non-digits', () => {
      expect(normalizeDigits('123.456')).toBe('123456')
      expect(normalizeDigits('abc-123')).toBe('123')
    })

    it('should return undefined for empty or null', () => {
      expect(normalizeDigits(null)).toBeUndefined()
      expect(normalizeDigits(undefined)).toBeUndefined()
      expect(normalizeDigits('')).toBeUndefined()
      expect(normalizeDigits('abc')).toBeUndefined()
    })
  })

  describe('formatCPF', () => {
    it('should format valid CPF string', () => {
      expect(formatCPF('12345678901')).toBe('123.456.789-01')
    })

    it('should return cleaned string if length is not 11', () => {
      expect(formatCPF('123')).toBe('123')
    })

    it('should return undefined for invalid input', () => {
      expect(formatCPF(null)).toBeUndefined()
    })
  })

  describe('formatCNPJ', () => {
    it('should format valid CNPJ string', () => {
      expect(formatCNPJ('12345678000199')).toBe('12.345.678/0001-99')
    })

    it('should return cleaned string if length is not 14', () => {
      expect(formatCNPJ('123')).toBe('123')
    })

    it('should return undefined for invalid input', () => {
      expect(formatCNPJ(null)).toBeUndefined()
    })
  })

  describe('formatCEP', () => {
    it('should format valid CEP string', () => {
      expect(formatCEP('12345678')).toBe('12345-678')
    })

    it('should return cleaned string if length is not 8', () => {
      expect(formatCEP('123')).toBe('123')
    })

    it('should return undefined for invalid input', () => {
      expect(formatCEP(null)).toBeUndefined()
    })
  })

  describe('isValidCEP', () => {
    it('should return true for valid CEP', () => {
      expect(isValidCEP('12345-678')).toBe(true)
      expect(isValidCEP('12345678')).toBe(true)
    })

    it('should return false for invalid CEP', () => {
      expect(isValidCEP('123')).toBe(false)
      expect(isValidCEP('123456789')).toBe(false)
    })
  })

  describe('formatPhone', () => {
    it('should format mobile phone', () => {
      expect(formatPhone('11987654321')).toBe('(11) 98765-4321')
    })

    it('should format landline phone', () => {
      expect(formatPhone('1133334444', false)).toBe('(11) 3333-4444')
    })

    it('should format mobile phone (explicit)', () => {
      expect(formatPhone('11987654321', true)).toBe('(11) 98765-4321')
    })

    it('should not normalize leading zero from three-digit DDD', () => {
      expect(formatPhone('021987654321')).toBe('021987654321')
      expect(formatPhone('04333334444', false)).toBe('04333334444')
    })

    it('should not normalize Brazil DDI prefixes', () => {
      expect(formatPhone('+55 (21) 98765-4321')).toBe('5521987654321')
      expect(formatPhone('55 043 3333-4444', false)).toBe('5504333334444')
      expect(formatPhone('05521987654321')).toBe('05521987654321')
    })

    it('should return clean string if length does not match', () => {
      expect(formatPhone('123')).toBe('123')
    })

    it('should return undefined for invalid input', () => {
      expect(formatPhone(null)).toBeUndefined()
    })
  })

  describe('formatPhoneForDisplay', () => {
    it('should infer mobile and landline masks from digit length', () => {
      expect(formatPhoneForDisplay('11987654321')).toBe('(11) 98765-4321')
      expect(formatPhoneForDisplay('1133334444')).toBe('(11) 3333-4444')
    })

    it('should honor explicit phone type when provided', () => {
      expect(formatPhoneForDisplay('1133334444', 'LANDLINE')).toBe('(11) 3333-4444')
      expect(formatPhoneForDisplay('11987654321', 'MOBILE')).toBe('(11) 98765-4321')
    })

    it('should preserve unsupported lengths as cleaned digits', () => {
      expect(formatPhoneForDisplay('+55 (21) 98765-4321')).toBe('5521987654321')
    })

    it('should return undefined when phone is nullish', () => {
      expect(formatPhoneForDisplay(null)).toBeUndefined()
      expect(formatPhoneForDisplay(undefined)).toBeUndefined()
    })
  })

  describe('normalizeBrazilPhoneDigits', () => {
    it('should only extract digits without inferring DDI or DDD trunk prefix', () => {
      expect(normalizeBrazilPhoneDigits('+55 (021) 98765-4321')).toBe('55021987654321')
      expect(normalizeBrazilPhoneDigits('05504333334444')).toBe('05504333334444')
    })

    it('should preserve area code 55 when there is no DDI-length prefix', () => {
      expect(normalizeBrazilPhoneDigits('(55) 99999-9999')).toBe('55999999999')
    })
  })

  describe('isValidCPF', () => {
    it('should validate correct CPF', () => {
      expect(isValidCPF('52998224725')).toBe(true)
      expect(isValidCPF('10000003700')).toBe(true) // Ends in 00
      expect(isValidCPF('10000016012')).toBe(true)
      expect(isValidCPF('12345678909')).toBe(true) // Valid CPF used in examples
    })

    it('should invalidate incorrect CPF', () => {
      expect(isValidCPF('11111111111')).toBe(false)
      expect(isValidCPF('12345678901')).toBe(false) // Valid first digit, invalid second
      expect(isValidCPF('12345678919')).toBe(false) // Invalid first digit
    })

    it('should invalidate CPF with wrong length', () => {
      expect(isValidCPF('123')).toBe(false)
      expect(isValidCPF('123456789012')).toBe(false)
    })
  })

  describe('isValidCNPJ', () => {
    it('should validate correct CNPJ', () => {
      expect(isValidCNPJ('06990590000123')).toBe(true)
      expect(isValidCNPJ('10000000000145')).toBe(true)
      expect(isValidCNPJ('11444777000161')).toBe(true)
      expect(isValidCNPJ('10000017000100')).toBe(true) // sum % 11 < 2 for both digits
    })

    it('should invalidate incorrect CNPJ', () => {
      expect(isValidCNPJ('11111111111111')).toBe(false)
      expect(isValidCNPJ('06990590000124')).toBe(false) // Invalid last digit
      expect(isValidCNPJ('06990590000133')).toBe(false) // Invalid first verification digit
    })

    it('should invalidate CNPJ with wrong length', () => {
      expect(isValidCNPJ('123')).toBe(false)
      expect(isValidCNPJ('123456789012345')).toBe(false)
    })
  })

  describe('isValidBirthDate', () => {
    it('should validate correct date string', () => {
      expect(isValidBirthDate('01012000', 'DMY')).toBe(true)
      expect(isValidBirthDate('01/01/2000', 'DMY')).toBe(true)
    })

    it('should validate correct Date object', () => {
      expect(isValidBirthDate(new Date(2000, 0, 1))).toBe(true)
    })

    it('should invalidate invalid date', () => {
      expect(isValidBirthDate('32012000', 'DMY')).toBe(false) // Day 32
      expect(isValidBirthDate('01132000', 'DMY')).toBe(false) // Month 13
    })

    it('should invalidate date with wrong length', () => {
      expect(isValidBirthDate('123')).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(isValidBirthDate(null as any)).toBe(false)
    })
  })
})





