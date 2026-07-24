/**
 * @module server.password
 * @description Cryptographically secure password generation helpers for server-side code.
 */

import crypto from 'node:crypto'

const UPPERCASE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWERCASE_CHARS = 'abcdefghijklmnopqrstuvwxyz'
const DIGIT_CHARS = '0123456789'
const SYMBOL_CHARS = '!@#$%^&*()-_=+[]{};:,.?'

/**
 * Options for password generation constraints and character sets.
 */
export interface GenerateRandomPasswordOptions {
  /** Total password length. */
  length?: number
  /** Minimum uppercase letters. */
  minUppercase?: number
  /** Minimum lowercase letters. */
  minLowercase?: number
  /** Minimum digits. */
  minDigits?: number
  /** Minimum symbols. */
  minSymbols?: number
  /** Whether symbols should be included in the filler alphabet. */
  includeSymbols?: boolean
  /** Custom symbol alphabet used when symbols are enabled or required. */
  symbolChars?: string
}

const randomChar = (chars: string): string => chars.charAt(crypto.randomInt(chars.length))

const assertCharSet = (name: string, value: string): void => {
  if (value.length === 0) {
    throw new Error(`${name} must not be empty`)
  }
}

/**
 * Generates a cryptographically secure random password.
 *
 * Default output preserves the previous contract: 10 alphanumeric characters
 * with at least one uppercase letter, one lowercase letter, and one digit.
 *
 * @param {GenerateRandomPasswordOptions} [options={}] - Password generation options.
 * @returns {string} Random password.
 */
export function generateRandomPassword({
  length = 10,
  minUppercase = 1,
  minLowercase = 1,
  minDigits = 1,
  minSymbols = 0,
  includeSymbols = false,
  symbolChars = SYMBOL_CHARS,
}: GenerateRandomPasswordOptions = {}): string {
  assertCharSet('symbolChars', symbolChars)

  const minimums = [
    { count: minUppercase, chars: UPPERCASE_CHARS },
    { count: minLowercase, chars: LOWERCASE_CHARS },
    { count: minDigits, chars: DIGIT_CHARS },
    { count: minSymbols, chars: symbolChars },
  ]

  if (!Number.isInteger(length) || length < 1) {
    throw new Error('length must be a positive integer')
  }

  for (const { count } of minimums) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('minimum character counts must be non-negative integers')
    }
  }

  const requiredLength = minimums.reduce((total, requirement) => total + requirement.count, 0)
  if (requiredLength > length) {
    throw new Error('minimum character counts cannot exceed password length')
  }

  const fillerChars = UPPERCASE_CHARS + LOWERCASE_CHARS + DIGIT_CHARS + (includeSymbols ? symbolChars : '')
  const passwordChars: string[] = []

  for (const { count, chars } of minimums) {
    for (let index = 0; index < count; index += 1) {
      passwordChars.push(randomChar(chars))
    }
  }

  while (passwordChars.length < length) {
    passwordChars.push(randomChar(fillerChars))
  }

  for (let index = passwordChars.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1)
    const current = passwordChars[index]
    passwordChars[index] = passwordChars[swapIndex]
    passwordChars[swapIndex] = current
  }

  return passwordChars.join('')
}
