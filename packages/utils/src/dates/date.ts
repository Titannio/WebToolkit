/**
 * @module date.utils
 * @description Comprehensive date manipulation and validation utilities.
 */

import type { DateInput, DateRange } from "./types.js";

/**
 * Supported orderings for ambiguous birth-date strings.
 */
export type BirthDateFormat = 'DMY' | 'MDY' | 'YMD'

function parseDateWithFormat(value: string, format: BirthDateFormat): Date | undefined {
  const clean = value.replace(/\D/g, '')

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
 * Normalizes a date to the very beginning of its day (00:00:00.000).
 * 
 * @param {DateInput} value - The date to normalize.
 * @returns {Date | undefined} - A new Date object set to the start of the day, or undefined if invalid.
 */
export function toStartOfDay(value: DateInput): Date | undefined {
  const d = toDate(value);
  if (!d) return undefined;
  const normalized = new Date(d);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

/**
 * Normalizes a date to the very end of its day (23:59:59.999).
 * 
 * @param {DateInput} value - The date to normalize.
 * @returns {Date | undefined} - A new Date object set to the end of the day, or undefined if invalid.
 */
export function toEndOfDay(value: DateInput): Date | undefined {
  const d = toDate(value);
  if (!d) return undefined;
  const normalized = new Date(d);
  normalized.setHours(23, 59, 59, 999);
  return normalized;
}

/**
 * Checks if two date ranges intersect.
 * 
 * The comparison is inclusive. A range overlaps if it starts before the other 
 * ends and ends after the other starts.
 * 
 * @param {DateRange} a - The first date range.
 * @param {DateRange} b - The second date range.
 * @returns {boolean} - True if the ranges overlap, false otherwise.
 */
export function isOverlapping(a: DateRange, b: DateRange): boolean {
  const startA = toDate(a.startDate);
  const endA = toDate(a.endDate);
  const startB = toDate(b.startDate);
  const endB = toDate(b.endDate);

  if (!startA || !endA || !startB || !endB) return false;

  return startA < endB && startB < endA;
}

/**
 * Calculates a future date by adding a specific number of months to a base date.
 * 
 * This utility is commonly used for calculating expiration dates or future 
 * billing cycles. The resulting date is automatically set to the end of the day 
 * (23:59:59.000) for consistent comparison.
 * 
 * @param {number} [months=1] - The number of months to add.
 * @param {Date} [base] - The starting date for the calculation. Defaults to the current date.
 * @returns {Date} - A new Date object representing the calculated point in time.
 * 
 * @example
 * calculateAhead(1, new Date('2023-01-01')) // Returns 2023-02-01T23:59:59.000
 */
export function calculateAhead(months: number = 1, base?: Date): Date {
  const now = base ? new Date(base) : new Date()
  const exp = new Date(now)
  exp.setMonth(now.getMonth() + months)
  exp.setHours(23, 59, 59, 0)
  return exp
}

/**
 * Safely converts various date-like inputs into a native JavaScript Date object.
 * 
 * This function is the primary entry point for date conversion, handling
 * strings, numbers (timestamps), and existing Date instances while filtering
 * out invalid dates.
 * 
 * @param {DateInput | undefined | null} v - The raw input to be converted.
 * @returns {Date | undefined} - A valid Date object or undefined if the input is nullish or invalid.
 * 
 * @example
 * toDate('2023-01-01') // Date object
 * toDate(1672531200000) // Date object
 * toDate('invalid-date') // undefined
 */
export function toDate(v: undefined | null): undefined;
/**
 * Converts date.
 * @param v - Parameter v.
 * @returns The function result.
 */
export function toDate(v: DateInput): Date | undefined;
/**
 * Converts date.
 * @param v - Parameter v.
 * @returns The function result.
 */
export function toDate(v: DateInput | undefined | null): Date | undefined;
/**
 * Implementation of the toDate utility for safe date conversion.
 * 
 * @param {DateInput | undefined | null} v - The raw input to be converted.
 * @returns {Date | undefined} - A valid Date object or undefined if the input is nullish or invalid.
 */
export function toDate(v: DateInput | undefined | null): Date | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return isNaN(v.getTime()) ? undefined : v;
  if (typeof v === "string" && v.trim() !== "") {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
      if (!v.includes('T') && !v.includes(':') && !v.includes(' ')) {
        const parts = v.split(/[-]/);
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        const day = parseInt(parts[2]);
        // Use noon (12:00) to provide a safety margin against timezone shifts
        const d = new Date(year, month - 1, day, 12, 0, 0);
        const isValid = !isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
        return isValid ? d : undefined;
      }
    }

    if (v.includes('T')) {
      const d = new Date(v);
      return isNaN(d.getTime()) ? undefined : d;
    }

    return undefined;
  }
  if (typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/**
 * Determines if a given date has already passed relative to the current time.
 * 
 * @param {DateInput} v - The date to evaluate.
 * @returns {boolean} - True if the date is in the past, false otherwise.
 * 
 * @see {@link isExpired} which is an alias for this function.
 */
export function isPast(v: DateInput): boolean {
  const d = toDate(v);
  return d ? d.getTime() < Date.now() : false;
}

/**
 * Determines if a given date is in the future relative to the current time.
 * 
 * @param {DateInput} v - The date to evaluate.
 * @returns {boolean} - True if the date is in the future, false otherwise.
 */
export function isFuture(v: DateInput): boolean {
  const d = toDate(v);
  return d ? d.getTime() > Date.now() : false;
}

/**
 * Validates whether a given input represents a realistic birth date.
 * 
 * Checks for:
 * 1. Correct format (ISO date strings, timestamps, or native Date).
 * 2. Logical date values (e.g., no Feb 30th).
 * 3. Realistic year bounds (post-1900 and not in the future).
 * 
 * @param {DateInput} input - The date to validate as a birth date.
 * @param {BirthDateFormat} [format] - Explicit order for ambiguous 8-digit or slash-formatted strings.
 * @returns {boolean} - True if the input is a valid and plausible birth date.
 */
export function isValidBirthDate(input: DateInput, format?: BirthDateFormat): boolean {
  if (!input) return false

  let day: number
  let month: number
  let year: number

  if (input instanceof Date) {
    day = input.getDate()
    month = input.getMonth() + 1
    year = input.getFullYear()
  } else if (typeof input === 'number') {
    const d = toDate(input)
    if (!d) return false
    day = d.getDate()
    month = d.getMonth() + 1
    year = d.getFullYear()
  } else {
    const isLocalizedBirthDateString = /^(\d{2}\D?\d{2}\D?\d{4}|\d{8})$/.test(input)
    const d =
      format && isLocalizedBirthDateString
        ? parseDateWithFormat(input, format)
        : toDate(input)
    if (!d) return false
    day = d.getDate()
    month = d.getMonth() + 1
    year = d.getFullYear()
  }

  if (isNaN(day) || isNaN(month) || isNaN(year)) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  if (year < 1900 || year > new Date().getFullYear()) return false

  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

/**
 * Checks if a resource has expired based on a date timestamp.
 * 
 * @param {DateInput} v - The date to evaluate.
 * @returns {boolean} - True if the date is in the past, false otherwise.
 * 
 * @see {@link isPast} for implementation details.
 */
export const isExpired = isPast;

/**
 * Creates a new Date object by adding a specific number of days to an existing date.
 * 
 * @param {DateInput | undefined | null} v - The starting date.
 * @param {number} days - The number of days to add (can be negative to subtract).
 * @returns {Date | undefined} - A new Date instance or undefined if the input date is invalid.
 */
export function addDays(v: DateInput | undefined | null, days: number): Date | undefined {
  const d = toDate(v);
  if (!d) return undefined;
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Creates a new Date object by adding a specific number of months to an existing date.
 * 
 * Note: Month addition handles edge cases (e.g., adding 1 month to Jan 31st results in Feb 28th/29th).
 * 
 * @param {DateInput | undefined | null} v - The starting date.
 * @param {number} months - The number of months to add (can be negative to subtract).
 * @returns {Date | undefined} - A new Date instance or undefined if the input date is invalid.
 */
export function addMonths(v: DateInput | undefined | null, months: number): Date | undefined {
  const d = toDate(v);
  if (!d) return undefined;
  const result = new Date(d);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Calculates the absolute numerical difference in days between two dates.
 * 
 * @param {DateInput | undefined | null} start - The first date.
 * @param {DateInput | undefined | null} end - The second date.
 * @returns {number | undefined} - The absolute difference in full days, or undefined if either input is invalid.
 * 
 * @example
 * diffDays('2023-01-01', '2023-01-10') // returns 9
 */
export function diffDays(start: DateInput | undefined | null, end: DateInput | undefined | null): number | undefined {
  const s = toDate(start);
  const e = toDate(end);
  if (!s || !e) return undefined;
  const diffTime = Math.abs(e.getTime() - s.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Converts a time string (HH:mm) into total minutes from the start of the day.
 * 
 * @param {string} value - Time string in format "HH:mm".
 * @returns {number} Total minutes.
 * 
 * @example
 * parseTimeToMinutes('08:30') // returns 510
 */
export function parseTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * Converts total minutes from the start of the day into an HH:mm string.
 *
 * @param {number} minutes - Total minutes.
 * @returns {string} Time string in HH:mm format.
 *
 * @example
 * minutesToTime(510) // returns '08:30'
 */
export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * Checks whether a value is a valid ISO local date string (YYYY-MM-DD).
 *
 * @param {unknown} value - Candidate value.
 * @returns {value is string} True when the value is a valid local date.
 */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
}

/**
 * Builds a YYYY-MM-DD string offset by civil days.
 *
 * @param {string} localDate - Base local date.
 * @param {number} daysToAdd - Civil days to add.
 * @returns {string} Shifted local date.
 */
export function addDaysToLocalDate(localDate: string, daysToAdd: number): string {
  const [year, month, day] = localDate.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + daysToAdd))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

/**
 * Converts a local date/time in an IANA timezone to a UTC instant.
 *
 * @param {string} localDate - Local date in YYYY-MM-DD format.
 * @param {string} localTime - Local time in HH:mm format.
 * @param {string} timezone - IANA timezone.
 * @returns {Date} UTC instant.
 */
export function zonedLocalDateTimeToUtc(localDate: string, localTime: string, timezone: string): Date {
  const [year, month, day] = localDate.split('-').map(Number)
  const [hour, minute] = localTime.split(':').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(formatter.formatToParts(new Date(utcGuess)).map((part) => [part.type, part.value]))
  const zonedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return new Date(utcGuess - (zonedAsUtc - utcGuess))
}

/**
 * Gets the current civil month for one timezone in YYYY-MM format.
 *
 * @param {string} timezone - Reference timezone.
 * @param {Date} [now] - Optional current instant override.
 * @returns {string} Current month value.
 */
export function getCurrentMonthValue(timezone: string, now = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}`
}

/**
 * Adds civil months to a YYYY-MM month value.
 *
 * @param {string} monthValue - Base month value.
 * @param {number} monthsToAdd - Number of months to add.
 * @returns {string} Result month value.
 */
export function addMonthsToMonthValue(monthValue: string, monthsToAdd: number): string {
  const [year, month] = monthValue.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1 + monthsToAdd, 1))
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Gets the maximum civil month allowed by a month-ahead horizon.
 *
 * @param {number} maxMonthsAhead - Horizon size.
 * @param {string} timezone - Reference timezone.
 * @param {Date} [now] - Optional current instant override.
 * @returns {string} Maximum allowed month value.
 */
export function getMaxMonthValue(maxMonthsAhead: number, timezone: string, now = new Date()): string {
  return addMonthsToMonthValue(getCurrentMonthValue(timezone, now), maxMonthsAhead)
}

/**
 * Checks whether a YYYY-MM month value is beyond a month-ahead horizon.
 *
 * @param {string} monthValue - Candidate month.
 * @param {number} maxMonthsAhead - Horizon size.
 * @param {string} timezone - Reference timezone.
 * @param {Date} [now] - Optional current instant override.
 * @returns {boolean} True when month is beyond the horizon.
 */
export function isMonthBeyondHorizon(
  monthValue: string,
  maxMonthsAhead: number,
  timezone: string,
  now = new Date(),
): boolean {
  return monthValue > getMaxMonthValue(maxMonthsAhead, timezone, now)
}

/**
 * Checks whether a local date is beyond a month-ahead horizon.
 *
 * @param {string} localDate - Candidate local date in YYYY-MM-DD format.
 * @param {number} maxMonthsAhead - Horizon size.
 * @param {string} timezone - Reference timezone.
 * @param {Date} [now] - Optional current instant override.
 * @returns {boolean} True when date is beyond the horizon month.
 */
export function isLocalDateBeyondMonthHorizon(
  localDate: string,
  maxMonthsAhead: number,
  timezone: string,
  now = new Date(),
): boolean {
  return isMonthBeyondHorizon(localDate.slice(0, 7), maxMonthsAhead, timezone, now)
}

/**
 * Converts a date input into a standard ISO 8601 string.
 * 
 * @param {DateInput | undefined | null} v - The date to format.
 * @returns {string | undefined} - An ISO string (e.g., "2023-01-01T00:00:00.000Z") or undefined if invalid.
 */
export function toISODate(v: DateInput | undefined | null): string | undefined {
  const d = toDate(v);
  return d ? d.toISOString() : undefined;
}
