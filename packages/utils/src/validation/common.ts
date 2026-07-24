
/**
 * @module validation.utils
 * @description Generic validation utilities for birth dates, emails, and dates.
 */

type DateInput = Date | string | number | null | undefined;

/**
 * Supported date formats for parsing string inputs.
 * - DMY: Day/Month/Year (e.g., 31/12/2023)
 * - MDY: Month/Day/Year (e.g., 12/31/2023) - USA style
 * - YMD: Year/Month/Day (e.g., 2023/12/31) - ISO/China style
 */
export type DateFormat = 'DMY' | 'MDY' | 'YMD';

const parseDateWithFormat = (value: string, format: DateFormat): Date | undefined => {
  const clean = value.replace(/\D/g, '')
  if (clean.length !== 8) return undefined

  let day: number
  let month: number
  let year: number

  if (format === 'MDY') {
    month = parseInt(clean.substring(0, 2), 10)
    day = parseInt(clean.substring(2, 4), 10)
    year = parseInt(clean.substring(4, 8), 10)
  } else if (format === 'YMD') {
    year = parseInt(clean.substring(0, 4), 10)
    month = parseInt(clean.substring(4, 6), 10)
    day = parseInt(clean.substring(6, 8), 10)
  } else {
    day = parseInt(clean.substring(0, 2), 10)
    month = parseInt(clean.substring(2, 4), 10)
    year = parseInt(clean.substring(4, 8), 10)
  }

  const parsedDate = new Date(year, month - 1, day)
  const isValid =
    !isNaN(parsedDate.getTime())
    && parsedDate.getFullYear() === year
    && parsedDate.getMonth() === month - 1
    && parsedDate.getDate() === day

  return isValid ? parsedDate : undefined
}

/**
 * Validates a user's birth date including age requirements.
 * Supports different formats for string inputs.
 * 
 * @param {DateInput} date - The date to check (Date object, string or timestamp).
 * @param {number} [minAge=18] - The minimum age required.
 * @param {DateFormat} [format] - The expected order for ambiguous string inputs.
 * @returns {date is Date | string | number} - True if the user is of valid age and the date is sensible.
 */
export function validateBirthDate(
  date: DateInput,
  minAge: number = 18,
  format?: DateFormat
): date is Date | string | number {
  if (!date) return false

  let birthDate: Date
  if (date instanceof Date) {
    birthDate = date
  } else if (typeof date === 'number') {
    birthDate = new Date(date)
  } else {
    const dateStr = String(date)

    if (dateStr.includes('-') && dateStr.length >= 10) {
      birthDate = new Date(dateStr)
    } else {
      if (!format) return false
      const parsedDate = parseDateWithFormat(dateStr, format)
      if (!parsedDate) return false
      birthDate = parsedDate
    }
  }

  if (isNaN(birthDate.getTime())) return false

  const today = new Date()
  if (birthDate > today) return false

  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }

  return age >= minAge
}

/**
 * Validates an email address against a standard RFC-like regular expression.
 * 
 * @param {string} email - The email string to validate.
 * @returns {boolean} - True if the email format is valid.
 * 
 * @example
 * validateEmail("user@website.com") // returns true
 * validateEmail("invalid-email")        // returns false
 */
export function validateEmail(email: string): boolean {
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/
  return re.test(email)
}

/**
 * Validates whether a given input represents a valid date.
 * 
 * @param {DateInput} date - The date input (Date object, ISO string, timestamp).
 * @returns {date is Date | string | number} - True if the input can be parsed into a valid Date object.
 * 
 * @example
 * validateDate('2023-01-01') // returns true
 * validateDate('invalid')    // returns false
 */
export function validateDate(date: DateInput): date is Date | string | number {
  if (!date) return false
  const d = new Date(date)
  return d instanceof Date && !isNaN(d.getTime())
}

/**
 * Validates a numeric string against a regular expression pattern.
 * Supports validation of both raw digits and masked values.
 * 
 * @param {string} val - The numeric value to validate.
 * @param {RegExp} pattern - The regular expression pattern to test against.
 * @returns {boolean} - True if the value matches the pattern.
 * 
 * @example
 * validateNumber('11987654321', /^\d{11}$/) // returns true
 */
export function validateNumber(val: string, pattern: RegExp): boolean {
  if (!val) return false
  return pattern.test(val)
}











