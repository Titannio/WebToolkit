/**
 * @module generator.utils
 * @description Unique identifier and filename generation utilities.
 */

import { randomInt } from 'es-toolkit'

/**
 * Configuration options for random string generation.
 */
export interface RandomStringOptions {
  /** If true, includes uppercase letters (A-Z). Defaults to true. */
  upperCase?: boolean
  /** If true, includes lowercase letters (a-z). Defaults to true. */
  lowerCase?: boolean
  /** If true, includes numbers (0-9). Defaults to true. */
  numbers?: boolean
  /** If true, includes special characters. Defaults to false. */
  special?: boolean
}

/**
 * Generates a random string of a given length with configurable character sets.
 * 
 * This version is agnostic and works in both Node.js and Browser environments.
 * 
 * @param {number} length - The desired length of the string.
 * @param {RandomStringOptions} [options] - Configuration for character sets to include.
 * @returns {string} The generated random string.
 * 
 * @example
 * const code = generateRandomString(6, { numbers: true, upperCase: false });
 * // returns e.g. "829104"
 */
export function generateRandomString(length: number, options: RandomStringOptions = {}): string {
  const {
    upperCase = true,
    lowerCase = true,
    numbers = true,
    special = false
  } = options

  const charSets = {
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower: 'abcdefghijklmnopqrstuvwxyz',
    number: '0123456789',
    special: '!@#$%^&*()_+-=[]{}|;:,.<>?'
  }

  let alphabet = ''
  if (upperCase) alphabet += charSets.upper
  if (lowerCase) alphabet += charSets.lower
  if (numbers) alphabet += charSets.number
  if (special) alphabet += charSets.special

  if (alphabet.length === 0) {
    throw new Error('At least one character set must be selected for random string generation.')
  }

  let output = ''
  for (let i = 0; i < length; i++) {
    output += alphabet[randomInt(0, alphabet.length - 1)]
  }
  return output
}

/**
 * Generates a random alphanumeric suffix of a specified length.
 * 
 * @param {number} [length=5] - The length of the suffix to generate.
 * @returns {string} - A random string containing lowercase letters and numbers.
 */
export function randomSuffix(length: number = 5): string {
  return generateRandomString(length, { upperCase: false, special: false })
}

/**
 * Generates a unique string with a timestamp followed by a random suffix.
 * Useful for creating unique identifiers or filenames.
 * 
 * @returns {string} - A unique string in the format `<timestamp><suffix>`.
 * 
 * @example
 * const id = genTimestampRandomSuffix();
 * // returns something like "1704700000000a1b2c"
 */
export function genTimestampRandomSuffix(): string {
  const timestamp = Date.now()
  return `${timestamp}${randomSuffix()}`
}

/**
 * Generates a unique filename using a prefix, timestamp, random suffix, and extension.
 * 
 * @param {string} prefix - The prefix for the filename (e.g., 'user_avatar').
 * @param {string} ext - The file extension (e.g., 'webp', '.jpg'). If it doesn't start with '.', it will be added.
 * @returns {string} - A unique filename string (e.g., 'user_avatar_1704700000000_a1b2c.webp').
 */
export function generateUniqueFilename(prefix: string, ext: string): string {
  const timestamp = Date.now();
  const suffix = randomSuffix(5);
  const extension = ext.startsWith('.') ? ext : `.${ext}`;
  return `${prefix}_${timestamp}_${suffix}${extension}`;
}









