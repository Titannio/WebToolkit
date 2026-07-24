/**
 * @module age.utils
 * @description Utilities for parsing civil dates and calculating age thresholds.
 */

/**
 * Supported civil-date string formats for localized parsing.
 */
export type CivilDateFormat = 'DMY' | 'MDY' | 'YMD'

/**
 * Structured civil date without time or timezone components.
 */
export interface CivilDateParts {
  year: number
  month: number
  day: number
}

/**
 * Validates whether a year/month/day tuple represents a real calendar date.
 *
 * @param {CivilDateParts} parts - Date parts to validate.
 * @returns {CivilDateParts | null} Normalized parts when valid, otherwise `null`.
 */
function validateCivilDateParts(parts: CivilDateParts): CivilDateParts | null {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() + 1 !== parts.month ||
    date.getUTCDate() !== parts.day
  ) {
    return null
  }

  return parts
}

/**
 * Parses an 8-digit civil date string using an explicit token order.
 *
 * @param {string} value - Raw string containing the civil date.
 * @param {CivilDateFormat} format - Expected token order.
 * @returns {CivilDateParts | null} Parsed date parts when valid, otherwise `null`.
 */
function parseFormattedCivilDate(value: string, format: CivilDateFormat): CivilDateParts | null {
  const clean = value.replace(/\D/g, '')
  if (clean.length !== 8) return null

  if (format === 'YMD') {
    return validateCivilDateParts({
      year: Number(clean.slice(0, 4)),
      month: Number(clean.slice(4, 6)),
      day: Number(clean.slice(6, 8)),
    })
  }

  if (format === 'MDY') {
    return validateCivilDateParts({
      year: Number(clean.slice(4, 8)),
      month: Number(clean.slice(0, 2)),
      day: Number(clean.slice(2, 4)),
    })
  }

  return validateCivilDateParts({
    year: Number(clean.slice(4, 8)),
    month: Number(clean.slice(2, 4)),
    day: Number(clean.slice(0, 2)),
  })
}

/**
 * Parses a date-like value into civil date parts using UTC-safe extraction.
 *
 * Accepts native `Date` instances, ISO-like strings, and optionally localized
 * date strings when an explicit format is provided.
 *
 * @param {string | Date | null | undefined} value - Input value to parse.
 * @param {CivilDateFormat} [format] - Expected format for localized strings.
 * @returns {CivilDateParts | null} Parsed civil date parts, or `null` when invalid.
 */
export function parseCivilDate(value?: string | Date | null, format?: CivilDateFormat): CivilDateParts | null {
  if (!value) return null

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null

    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    }
  }

  const normalized = value.trim()
  if (!normalized) return null

  const isoDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoDateMatch) {
    return validateCivilDateParts({
      year: Number(isoDateMatch[1]),
      month: Number(isoDateMatch[2]),
      day: Number(isoDateMatch[3]),
    })
  }

  if (format) {
    const parsedFormatted = parseFormattedCivilDate(normalized, format)
    if (parsedFormatted) return parsedFormatted
  }

  return null
}

/**
 * Calculates the age for a civil date relative to a reference date.
 *
 * @param {string | Date | null | undefined} value - Birth or civil date input.
 * @param {Date} [referenceDate=new Date()] - Date used as the age reference.
 * @param {CivilDateFormat} [format] - Expected format for localized strings.
 * @returns {number | null} Age in full years, or `null` when the input is invalid or future-dated.
 */
export function getAgeFromDate(
  value?: string | Date | null,
  referenceDate = new Date(),
  format?: CivilDateFormat,
): number | null {
  const parsed = parseCivilDate(value, format)
  if (!parsed || Number.isNaN(referenceDate.getTime())) return null

  let age = referenceDate.getFullYear() - parsed.year
  const currentMonth = referenceDate.getMonth() + 1
  const monthDiff = currentMonth - parsed.month

  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < parsed.day)) {
    age -= 1
  }

  return age < 0 ? null : age
}

/**
 * Checks whether a civil date reaches a minimum age threshold.
 *
 * @param {string | Date | null | undefined} value - Birth or civil date input.
 * @param {number} minimumAge - Minimum age in full years.
 * @param {Date} [referenceDate=new Date()] - Date used as the comparison reference.
 * @param {CivilDateFormat} [format] - Expected format for localized strings.
 * @returns {boolean} `true` when the parsed age is at least the requested threshold.
 */
export function isAtLeastAge(
  value: string | Date | undefined | null,
  minimumAge: number,
  referenceDate = new Date(),
  format?: CivilDateFormat,
): boolean {
  const age = getAgeFromDate(value, referenceDate, format)
  return age !== null && age >= minimumAge
}
