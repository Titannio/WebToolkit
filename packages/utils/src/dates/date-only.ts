/**
 * @module date-only
 * @description Utilities for working with date-only values (no time component).
 * Eliminates timezone issues for birth dates and other date-only fields.
 */

/**
 * Type representing a canonical ISO date-only string in YYYY-MM-DD format.
 * @example "1990-02-15"
 */
export type ISODateOnlyString = string & { readonly __brand: 'ISODateOnlyString' }

/**
 * Backward-compatible alias for ISO date-only strings.
 */
export type DateString = ISODateOnlyString

/**
 * Simple object representing a date without time.
 */
export interface DateOnly {
  year: number
  month: number // 1-12
  day: number
}

/**
 * Converts an ISO date-only string (YYYY-MM-DD) to a DateOnly object.
 * 
 * @param {ISODateOnlyString | string} dateStr - Date string in YYYY-MM-DD format.
 * @returns {DateOnly | undefined} - DateOnly object or undefined if invalid
 * 
 * @example
 * dateStringToDateOnly('1990-02-15') // { year: 1990, month: 2, day: 15 }
 */
export function dateStringToDateOnly(dateStr: ISODateOnlyString | string): DateOnly | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return undefined

  const year = parseInt(dateStr.substring(0, 4), 10)
  const month = parseInt(dateStr.substring(5, 7), 10)
  const day = parseInt(dateStr.substring(8, 10), 10)

  if (isNaN(day) || isNaN(month) || isNaN(year)) return undefined
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return undefined

  const parsedDate = new Date(year, month - 1, day)
  const isValid =
    parsedDate.getFullYear() === year
    && parsedDate.getMonth() === month - 1
    && parsedDate.getDate() === day

  return isValid ? { year, month, day } : undefined
}

/**
 * Converts a DateOnly object to an ISO date-only string (YYYY-MM-DD).
 * 
 * @param {DateOnly} date - DateOnly object
 * @returns {ISODateOnlyString} - Date string in YYYY-MM-DD format
 * 
 * @example
 * dateOnlyToDateString({ year: 1990, month: 2, day: 15 }) // '1990-02-15'
 */
export function dateOnlyToDateString(date: DateOnly): ISODateOnlyString {
  const year = String(date.year)
  const month = String(date.month).padStart(2, '0')
  const day = String(date.day).padStart(2, '0')
  return `${year}-${month}-${day}` as ISODateOnlyString
}

/**
 * Converts a Date object to a DateOnly object (ignoring time).
 * Uses local timezone to extract day/month/year.
 * 
 * @param {Date} date - JavaScript Date object
 * @returns {DateOnly} - DateOnly object
 * 
 * @example
 * dateToDateOnly(new Date(1990, 1, 15)) // { year: 1990, month: 2, day: 15 }
 */
export function dateToDateOnly(date: Date): DateOnly {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1, // JS months are 0-indexed
    day: date.getDate(),
  }
}

/**
 * Converts a DateOnly object to a JavaScript Date object at midnight local time.
 * 
 * @param {DateOnly} date - DateOnly object
 * @returns {Date} - JavaScript Date object at midnight
 * 
 * @example
 * dateOnlyToDate({ year: 1990, month: 2, day: 15 }) // Date object for Feb 15, 1990 00:00:00
 */
export function dateOnlyToDate(date: DateOnly): Date {
  return new Date(date.year, date.month - 1, date.day, 0, 0, 0, 0)
}

/**
 * Converts an ISO date-only string to a JavaScript Date object at midnight local time.
 * 
 * @param {ISODateOnlyString | string} dateStr - Date string in YYYY-MM-DD format
 * @returns {Date | undefined} - JavaScript Date object or undefined if invalid
 * 
 * @example
 * dateStringToDate('1990-02-15') // Date object for Feb 15, 1990 00:00:00
 */
export function dateStringToDate(dateStr: ISODateOnlyString | string): Date | undefined {
  const dateOnly = dateStringToDateOnly(dateStr)
  return dateOnly ? dateOnlyToDate(dateOnly) : undefined
}

/**
 * Converts a JavaScript Date to an ISO date-only string (YYYY-MM-DD).
 * 
 * @param {Date} date - JavaScript Date object
 * @returns {ISODateOnlyString} - Date string in YYYY-MM-DD format
 * 
 * @example
 * dateToDateString(new Date(1990, 1, 15)) // '1990-02-15'
 */
export function dateToDateString(date: Date): ISODateOnlyString {
  const dateOnly = dateToDateOnly(date)
  return dateOnlyToDateString(dateOnly)
}

/**
 * Formats a DateOnly object as the package's canonical date-only string.
 * 
 * @param {DateOnly} date - DateOnly object
  * @returns {string} - Formatted string
 * 
 * @example
 * formatDateOnly({ year: 1990, month: 2, day: 15 }) // '1990-02-15'
 */
export function formatDateOnly(date: DateOnly): string {
  return dateOnlyToDateString(date)
}

/**
 * Formats an ISO date-only string using the package's canonical representation.
 * 
 * @param {ISODateOnlyString | string} dateStr - Date string in YYYY-MM-DD format
 * @returns {string} - Formatted string or empty string if invalid
 * 
 * @example
 * formatDateString('1990-02-15') // '1990-02-15'
 */
export function formatDateString(dateStr: ISODateOnlyString | string): string {
  const dateOnly = dateStringToDateOnly(dateStr)
  return dateOnly ? formatDateOnly(dateOnly) : ''
}
