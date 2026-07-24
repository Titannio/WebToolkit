/**
 * @module date.types
 * @description Type definitions for date-related utility functions.
 */

/**
 * Represents supported date-like inputs used across utility helpers.
 * 
 * This union type facilitates the handling of various date formats commonly
 * encountered in the application, including database timestamps, API responses,
 * and native JavaScript date objects.
 * 
 * @type {Date | string | number}
 * @see {@link Date}
 */
export type DateInput = Date | string | number

/**
 * Generic dictionary of date fields keyed by name.
 */
export interface Dates {
    /** @type {DateInput | undefined} - Date input value. */
    [key: string]: DateInput | undefined;
}

/**
 * Represents an inclusive date range.
 */
export interface DateRange {
    /** @type {DateInput} - Range start date. */
    startDate: DateInput
    /** @type {DateInput} - Range end date. */
    endDate: DateInput
}

/**
 * Type-only marker used to keep this module in runtime export maps.
 */
export const __dateTypes = true as const
