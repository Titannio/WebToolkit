/**
 * @module json.utils
 * @description JSON processing, normalization, and cleanup utilities.
 */

import { toDate } from '../dates/date.js'

/**
 * Strict matcher for full ISO datetime strings used by JSON payloads.
 *
 * Accepts:
 * - UTC timestamps ending with `Z`
 * - Datetimes with explicit timezone offsets (`+03:00`, `-04:00`)
 * - Fractional seconds
 */
const ISO_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/

/**
 * Parses string dates while preserving exact timezone semantics for full ISO datetimes.
 *
 * For full ISO datetime values, this uses the native `Date` parser directly
 * to preserve the original instant in time. For other date-like strings,
 * it falls back to {@link toDate}.
 *
 * @param {string} value - Raw date string to parse.
 * @returns {Date | undefined} - Parsed Date or undefined when parsing fails.
 */
const parseDateString = (value: string): Date | undefined => {
  if (ISO_DATETIME_REGEX.test(value)) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  return toDate(value)
}

/**
 * Recursively removes nodes with value equal to `valueToRemove` and empty objects/arrays.
 * 
 * This is useful for cleaning up sparse data structures or removing specific 
 * placeholder values from a deep object tree.
 * 
 * @param {unknown} input - Input structure (object/array/value) to be cleaned.
 * @param {string} valueToRemove - Target value that should be pruned from the tree.
 * @returns {unknown} - The cleaned structure, or `undefined` if the result is empty.
 * 
 * @example
 * cleanTree({ a: "", b: 1 }, "") // returns { b: 1 }
 * cleanTree([ "", { a: "" } ], "") // returns undefined
 */
export function cleanTree(input: unknown, valueToRemove: string): unknown {
  if (input === valueToRemove) return undefined;
  if (Array.isArray(input)) {
    const cleanedArray = input
      .map(item => cleanTree(item, valueToRemove))
      .filter(item => item !== undefined &&
        item !== null &&
        !(typeof item === "object" && Object.keys(item as object).length === 0)
      );

    return cleanedArray.length > 0 ? cleanedArray : undefined;
  }

  if (typeof input === "object" && input !== null) {
    const result: Record<string, unknown> = {};
    const obj = input as Record<string, unknown>;

    for (const key in obj) {
      if (!Object.hasOwn(obj, key)) continue
      const value = obj[key];

      // remove node if value is exactly the one specified
      if (value === valueToRemove) continue;

      const cleaned = cleanTree(value, valueToRemove);

      if (cleaned !== undefined &&
        cleaned !== null &&
        !(typeof cleaned === "object" && Object.keys(cleaned as object).length === 0)) {
        result[key] = cleaned;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  // non-object and non-array values remain
  return input;
}

/**
 * Utility type that transforms a Mongo/Mongoose object type into a plain API object.
 * It removes internal `_id` and `__v` properties and adds an optional `id` string.
 * 
 * @template T - The source object type.
 */
export type Normalized<T> = Omit<T, '_id' | '__v'> & { id?: string };

/**
 * Normalizes a Mongo/Mongoose object: converts `_id` to `id` and removes `__v`.
 * 
 * This is a standard transformation for API responses to ensure IDs are 
 * strings and internal version keys are hidden.
 * 
 * @param {T} input - Source object, can be a `Document` or plain object with `_id`.
 * @returns {Normalized<T>} - The normalized object with string ID and without version keys.
 * 
 * @example
 * normalizeId({ _id: "abc", __v: 0, name: "test" }) 
 * // returns { id: "abc", name: "test" }
 */
export function normalizeId<T extends { _id?: unknown; __v?: unknown }>(input: T): Normalized<T> {
  const { _id, __v: _v, ...rest } = input;
  return {
    ...rest,
    id: _id ? String(_id) : undefined
  } as Normalized<T>;
}

/**
 * Recursively removes undefined values from an object or array.
 * 
 * This is critical for preparing payloads for database updates (e.g., MongoDB `$set`) 
 * where undefined values should not be persisted, while nulls should be kept 
 * to explicitly unset fields.
 *
 * @param {T} obj - The object or array to clean.
 * @returns {T} - A new object without undefined values.
 * 
 * @example
 * removeUndefined({ a: 1, b: undefined, c: null }) // returns { a: 1, c: null }
 */
export function removeUndefined<T>(obj: T): T {
  if (obj === undefined) {
    return undefined as unknown as T
  }

  if (Array.isArray(obj)) {
    // Keep empty arrays, but filter out undefined items
    return obj.filter(item => item !== undefined).map(item => removeUndefined(item)) as unknown as T
  }

  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const cleaned: Record<string, unknown> = {}
    const record = obj as Record<string, unknown>

    for (const key in record) {
      if (Object.hasOwn(record, key)) {
        const value = removeUndefined(record[key])
        // Only keep value if it's not undefined
        // We KEEP nulls to ensure "unset" behavior in DB
        if (value !== undefined) {
          cleaned[key] = value
        }
      }
    }
    return cleaned as unknown as T
  }

  return obj
}

/**
 * Recursively transforms ISO date strings into JavaScript Date objects.
 * 
 * Useful for restoring Date objects from JSON payloads that have been 
 * serialized for transport.
 * 
 * @template T - The expected return type after date parsing.
 * @param {unknown} data - The object or array to normalize.
 * @param {string[]} [fields] - Optional list of specific fields to convert. 
 *                 If provided, ONLY these fields will be checked and converted.
 *                 If NOT provided, it attempts to detect ISO strings automatically.
 *                 Nested objects are still traversed recursively in both modes.
 * @returns {T} - The normalized data with Date instances.
 * 
 * @example
 * const result = parseJSONDates<{ date: Date }>({ date: "2023-01-01T00:00:00.000Z" }) 
 * // returns { date: Date object }
 */
export function parseJSONDates<T = unknown>(data: unknown, fields?: string[]): T {
  if (data === null || data === undefined) return data as unknown as T;

  if (data instanceof Date) return data as unknown as T;

  if (Array.isArray(data)) {
    return data.map(item => parseJSONDates(item, fields)) as unknown as T;
  }

  // Handle top-level string (if it's an ISO date)
  if (typeof data === 'string' && !fields) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(data)) {
      const date = parseDateString(data);
      return (date !== undefined ? date : data) as unknown as T;
    }
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    const obj = data as Record<string, unknown>;

    for (const key of Object.keys(obj)) {
      const value = obj[key];

      // If fields are specified, only process those keys
      if (fields) {
        if (fields.includes(key)) {
          // Attempt conversion
          if (typeof value === 'string') {
            const date = parseDateString(value);
            result[key] = date !== undefined ? date : value;
          } else {
            result[key] = value;
          }
        } else {
          // Recurse for nested objects
          if (typeof value === 'object' && value !== null) {
            result[key] = parseJSONDates(value, fields);
          } else {
            result[key] = value;
          }
        }
      } else {
        // Auto-detection mode
        if (typeof value === 'string') {
          // Simple ISO 8601 check (starts with YYYY-MM-DD)
          if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
            const date = parseDateString(value);
            result[key] = date !== undefined ? date : value;
          } else {
            result[key] = value;
          }
        } else if (typeof value === 'object' && value !== null) {
          result[key] = parseJSONDates(value);
        } else {
          result[key] = value;
        }
      }
    }
    return result as unknown as T;
  }

  return data as unknown as T;
}

export { merge as deepMerge } from 'es-toolkit';









