/**
 * @module location.phone-masks
 * @description Phone mask definitions by country code.
 */

import {
  buildDigitPatternVariants,
  isBetterDigitPatternScore,
  scoreDigitPatternSuffix,
  type DigitPatternScore,
} from '../text/digit-patterns.js'
import { onlyNumbers } from '../text/transformers.js'
import { PHONE_TYPE } from "../types/phone.js"

/**
 * Union of all supported phone mask types derived from {@link PHONE_TYPE}.
 * 
 * This keeps the public type surface in sync with the internal enum while
 * still providing strong typing for configuration objects and helpers.
 */
export type PhoneMaskType = (typeof PHONE_TYPE)[keyof typeof PHONE_TYPE]

/**
 * Describes a single phone formatting rule for a given phone type.
 * 
 * @property {PhoneMaskType} type - Logical type of the phone number (mobile, landline or default).
 * @property {string} mask - Human-friendly mask string used by input components.
 * @property {string} regex - Regular expression (as string) used to validate the full E.164 number.
 * @property {string} example - Example number that matches the mask and regex.
 * @property {string} [notes] - Optional implementation notes or behavioral hints.
 */
export interface PhoneMask {
  type: PhoneMaskType
  mask: string
  regex: string
  example: string
  notes?: string
}

/**
 * Configuration of phone masks for a specific country.
 * 
 * @property {string} name - Human-readable country name.
 * @property {string} countryCode - Country calling code in E.164 format (e.g. "+55").
 * @property {PhoneMask[]} masks - List of supported phone masks for this country.
 */
export interface CountryPhoneConfig {
  name: string
  countryCode: string
  masks: PhoneMask[]
}

/**
 * Exports the structure of country phone masks.
 */
export const COUNTRY_PHONE_MASKS: Record<string, CountryPhoneConfig> = {
  BR: {
    name: 'Brazil',
    countryCode: '+55',
    masks: [
      {
        type: PHONE_TYPE.MOBILE,
        mask: '(##) #####-####',
        regex: '^\\+55\\d{2}9\\d{8}$',
        example: '+55 11 91234-5678',
        notes: 'Mobile numbers always use 9 digits after the area code.',
      },
      {
        type: PHONE_TYPE.LANDLINE,
        mask: '(##) ####-####',
        regex: '^\\+55\\d{10}$',
        example: '+55 11 1234-5678',
      },
    ],
  },
  US: {
    name: 'United States',
    countryCode: '+1',
    masks: [
      {
        type: PHONE_TYPE.DEFAULT,
        mask: '(###) ###-####',
        regex: '^\\+1\\d{10}$',
        example: '+1 202 555 0123',
      },
    ],
  },
  UK: {
    name: 'United Kingdom',
    countryCode: '+44',
    masks: [
      {
        type: PHONE_TYPE.MOBILE,
        mask: '#### ### ####',
        regex: '^\\+447\\d{9}$',
        example: '+44 7911 123456',
      },
      {
        type: PHONE_TYPE.LANDLINE,
        mask: '#### ######',
        regex: '^\\+44\\d{10}$',
        example: '+44 20 7946 0958',
      },
    ],
  },
  DE: {
    name: 'Germany',
    countryCode: '+49',
    masks: [
      {
        type: PHONE_TYPE.DEFAULT,
        mask: '#### ########',
        regex: '^\\+49\\d{10,14}$',
        example: '+49 151 23456789',
        notes: 'Length may vary.',
      },
    ],
  },
  FR: {
    name: 'France',
    countryCode: '+33',
    masks: [
      {
        type: PHONE_TYPE.DEFAULT,
        mask: '# ## ## ## ##',
        regex: '^\\+33\\d{9}$',
        example: '+33 6 12 34 56 78',
      },
    ],
  },
  ES: {
    name: 'Spain',
    countryCode: '+34',
    masks: [
      {
        type: PHONE_TYPE.DEFAULT,
        mask: '### ### ###',
        regex: '^\\+34\\d{9}$',
        example: '+34 612 345 678',
      },
    ],
  },
  IT: {
    name: 'Italy',
    countryCode: '+39',
    masks: [
      {
        type: PHONE_TYPE.DEFAULT,
        mask: '### #######',
        regex: '^\\+39\\d{9,10}$',
        example: '+39 312 3456789',
        notes: 'Length may vary between 9 and 10 digits.',
      },
    ],
  },
  IN: {
    name: 'India',
    countryCode: '+91',
    masks: [
      {
        type: PHONE_TYPE.MOBILE,
        mask: '##### #####',
        regex: '^\\+91[6-9]\\d{9}$',
        example: '+91 98765 43210',
      },
    ],
  },
  CN: {
    name: 'China',
    countryCode: '+86',
    masks: [
      {
        type: PHONE_TYPE.MOBILE,
        mask: '### #### ####',
        regex: '^\\+861[3-9]\\d{9}$',
        example: '+86 138 0013 8000',
      },
    ],
  },
  JP: {
    name: 'Japan',
    countryCode: '+81',
    masks: [
      {
        type: PHONE_TYPE.MOBILE,
        mask: '##-####-####',
        regex: '^\\+8190\\d{8}$',
        example: '+81 90-1234-5678',
      },
    ],
  },
  AU: {
    name: 'Australia',
    countryCode: '+61',
    masks: [
      {
        type: PHONE_TYPE.MOBILE,
        mask: '### ### ###',
        regex: '^\\+614\\d{8}$',
        example: '+61 412 345 678',
      },
    ],
  },
}

/**
 * Looks up the phone configuration for a given country code.
 * 
 * The lookup is case-insensitive and accepts codes with or without a leading
 * plus sign, as long as they match the keys defined in {@link COUNTRY_PHONE_MASKS}.
 * 
 * @param {string} countryCode - Country identifier such as "BR" or "+br".
 * @returns {CountryPhoneConfig | undefined} Matching configuration, or `undefined` when not found.
 */
export function getCountryConfig(countryCode: string): CountryPhoneConfig | undefined {
  const normalized = countryCode.toUpperCase().replace(/^\+/, '')
  return COUNTRY_PHONE_MASKS[normalized]
}

/**
 * Detects the most appropriate phone mask type for a given phone number.
 *
 * Detection is driven by the configured mask regex patterns rather than
 * country-specific hardcoded digit positions. The matcher first normalizes the
 * local digits for the selected country and then prefers:
 * 1. exact full-length matches
 * 2. more specific token matches (literal digits and digit classes)
 * 3. masks that require fewer omitted leading digits
 * 
 * @param {string} phone - Raw phone input, with or without formatting characters.
 * @param {CountryPhoneConfig} config - Country configuration used for detection.
 * @returns {PhoneMaskType} Detected phone mask type for the given number.
 */
export function detectPhoneMaskType(phone: string, config: CountryPhoneConfig): PhoneMaskType {
  const digits = onlyNumbers(phone)
  const countryCodeDigits = onlyNumbers(config.countryCode)
  const localDigits = digits.startsWith(countryCodeDigits)
    ? digits.slice(countryCodeDigits.length)
    : digits

  let bestMatch: { type: PhoneMaskType; score: DigitPatternScore } | undefined

  for (const mask of config.masks) {
    const variants = buildDigitPatternVariants(mask.regex, countryCodeDigits)

    for (const variant of variants) {
      const score = scoreDigitPatternSuffix(localDigits, variant)
      if (!score) continue

      if (!bestMatch || isBetterDigitPatternScore(score, bestMatch.score)) {
        bestMatch = { type: mask.type, score }
      }
    }
  }

  return bestMatch?.type || config.masks[0]?.type || PHONE_TYPE.DEFAULT
}
