/**
 * @module transformer.utils
 * @description Data transformation and normalization utilities.
 */

/**
 * @description Splits a delimited string into an array of trimmed strings.
 * Useful for preprocessing query parameters or CSV-like inputs in Zod schemas.
 * 
 * @param {unknown} val - The input value to process.
 * @param {string} [separator=','] - The delimiter character or string.
 * @returns {unknown} - An array of strings if the input is a string containing the separator, otherwise the original value.
 * 
 * @example
 * stringToDelimitedArray('a,b, c') // returns ['a', 'b', 'c']
 * stringToDelimitedArray('single') // returns 'single'
 * stringToDelimitedArray(['already', 'array']) // returns ['already', 'array']
 */
export function stringToDelimitedArray(val: unknown, separator: string = ','): unknown {
  if (typeof val === 'string' && val.includes(separator)) {
    return val.split(separator).map(s => s.trim())
  }
  return val
}

/**
 * Removes all non-numeric characters from a string.
 * Commonly used for cleaning phone numbers, CPFs, and other numeric documents.
 * 
 * @param {string | undefined | null} val - The input string to clean.
 * @returns {string} - A string containing only digits.
 * 
 * @example
 * onlyNumbers('(11) 98765-4321') // returns '11987654321'
 */
export function onlyNumbers(val: string | undefined | null): string {
  if (!val) return ''
  return val.replace(/\D/g, '')
}

/**
 * Applies a mask to a string based on a provided pattern.
 * Supports progressive masking for real-time input formatting.
 * 
 * @param {string} val - The raw value to mask.
 * @param {string} pattern - The mask pattern (e.g., '(99) 9999-9999'). Use '9' for digits.
 * @returns {string} - The masked string.
 * 
 * @example
 * maskNumber('1198765', '(99) 9999-9999') // returns '(11) 9876-5'
 */
export function maskNumber(val: string, pattern: string): string {
  if (!val) return ''

  const digits = onlyNumbers(val)
  let masked = ''
  let digitIdx = 0

  for (let i = 0; i < pattern.length && digitIdx < digits.length; i++) {
    const maskChar = pattern[i]
    if (maskChar === '9') {
      masked += digits[digitIdx]
      digitIdx++
    } else {
      masked += maskChar
    }
  }

  return masked
}

/**
 * Removes HTML tags from a string and trims the result.
 * 
 * Useful for sanitizing user-provided text that should only contain plain text.
 * 
 * @param {string | undefined} value - The input string to sanitize.
 * @returns {string | undefined} - The sanitized string or the original input if it was not a string.
 * 
 * @example
 * stripHtmlTags('<p>Hello <b>World</b></p>') // returns "Hello World"
 */
export function stripHtmlTags(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return value
  }
  return value.replace(/<[^>]*>?/gm, '').trim()
}
