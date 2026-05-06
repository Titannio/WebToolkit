import { describe, it, expect } from 'vitest'
import { stringToDelimitedArray, onlyNumbers, maskNumber, stripHtmlTags } from '@src/text/transformers.js'

describe('Transformers: stringToDelimitedArray', () => {
  it('should split comma-separated string into array', () => {
    expect(stringToDelimitedArray('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('should trim whitespace from elements', () => {
    expect(stringToDelimitedArray(' a , b , c ')).toEqual(['a', 'b', 'c'])
  })

  it('should return original string if no separator found', () => {
    expect(stringToDelimitedArray('single')).toBe('single')
  })

  it('should handle custom separator', () => {
    expect(stringToDelimitedArray('a|b|c', '|')).toEqual(['a', 'b', 'c'])
  })
  it('should return non-string values as is', () => {
    const arr = ['a', 'b']
    expect(stringToDelimitedArray(arr)).toBe(arr)
    expect(stringToDelimitedArray(123)).toBe(123)
    expect(stringToDelimitedArray(null)).toBe(null)
    expect(stringToDelimitedArray(undefined)).toBe(undefined)
  })
})

describe('Transformers: onlyNumbers', () => {
  it('should remove all non-digit characters', () => {
    expect(onlyNumbers('(11) 98765-4321')).toBe('11987654321')
    expect(onlyNumbers('abc123def456')).toBe('123456')
  })
  it('should return empty string for falsy inputs', () => {
    expect(onlyNumbers(undefined)).toBe('')
    expect(onlyNumbers(null)).toBe('')
    expect(onlyNumbers('')).toBe('')
  })
})

describe('Transformers: maskNumber', () => {
  it('should mask number correctly', () => {
    expect(maskNumber('11987654321', '(99) 99999-9999')).toBe('(11) 98765-4321')
    expect(maskNumber('123', '999')).toBe('123')
  })
  it('should handle empty input', () => {
    expect(maskNumber('', '999')).toBe('')
  })
  it('should stop when no more digits and subsequent mask is not a placeholder', () => {
    expect(maskNumber('11', '99--99')).toBe('11')
  })
})

describe('Transformers: stripHtmlTags', () => {
  it('should remove HTML tags correctly', () => {
    expect(stripHtmlTags('<p>Hello <b>World</b></p>')).toBe('Hello World')
    expect(stripHtmlTags('Text with <br/> break')).toBe('Text with  break')
  })

  it('should return undefined for non-string input', () => {
    expect(stripHtmlTags(undefined)).toBeUndefined()
    expect(stripHtmlTags(null as any)).toBeNull()
  })

  it('should trim whitespace', () => {
    expect(stripHtmlTags('   <p>Text</p>   ')).toBe('Text')
  })
})









