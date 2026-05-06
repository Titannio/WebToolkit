/**
 * @module bson.utils
 * @description Utilities for handling BSON Extended JSON format, commonly used in database exports.
 */

/**
 * Represents a BSON ObjectId in Extended JSON format.
 */
export interface BsonOid {
  /** 
   * The 24-character hexadecimal string.
   * @type {string}
   */
  $oid: string
}

/**
 * Represents a BSON Date in Extended JSON format.
 */
export interface BsonDate {
  /** 
   * ISO string or numeric timestamp.
   * @type {string | number}
   */
  $date: string | number
}

/**
 * Represents a BSON 32-bit integer in Extended JSON format.
 */
export interface BsonNumberInt {
  /** 
   * The string representation of the integer.
   * @type {string}
   */
  $numberInt: string
}

/**
 * Represents a BSON 64-bit integer in Extended JSON format.
 */
export interface BsonNumberLong {
  /** 
   * The string representation of the long integer.
   * @type {string}
   */
  $numberLong: string
}

/**
 * Represents a BSON double-precision floating point number in Extended JSON format.
 */
export interface BsonNumberDouble {
  /** 
   * The string representation of the double.
   * @type {string}
   */
  $numberDouble: string
}

/**
 * Type guard for BSON ObjectId.
 * @param {unknown} v - The value to test.
 * @returns {boolean} - True if the value is a BsonOid.
 */
export function isBsonOid(v: unknown): v is BsonOid {
  return v !== null && typeof v === 'object' && '$oid' in v
}

/**
 * Type guard for BSON Date.
 * @param {unknown} v - The value to test.
 * @returns {boolean} - True if the value is a BsonDate.
 */
export function isBsonDate(v: unknown): v is BsonDate {
  return v !== null && typeof v === 'object' && '$date' in v
}

/**
 * Type guard for BSON 32-bit integer.
 * @param {unknown} v - The value to test.
 * @returns {boolean} - True if the value is a BsonNumberInt.
 */
export function isBsonNumberInt(v: unknown): v is BsonNumberInt {
  return v !== null && typeof v === 'object' && '$numberInt' in v
}

/**
 * Type guard for BSON 64-bit integer.
 * @param {unknown} v - The value to test.
 * @returns {boolean} - True if the value is a BsonNumberLong.
 */
export function isBsonNumberLong(v: unknown): v is BsonNumberLong {
  return v !== null && typeof v === 'object' && '$numberLong' in v
}

/**
 * Type guard for BSON double.
 * @param {unknown} v - The value to test.
 * @returns {boolean} - True if the value is a BsonNumberDouble.
 */
export function isBsonNumberDouble(v: unknown): v is BsonNumberDouble {
  return v !== null && typeof v === 'object' && '$numberDouble' in v
}

/**
 * Recursively converts BSON Extended JSON structures into plain JavaScript types.
 * 
 * This utility is essential when processing raw MongoDB exports or API responses
 * that use the Extended JSON format (e.g., from `mongoexport` or certain drivers).
 * It converts types like `$oid` to strings, `$date` to Date objects, and 
 * `$numberLong` to native numbers.
 * For invalid `$date` values, it falls back to `new Date()` to avoid propagating invalid dates.
 * 
 * @param {unknown} v - The value or object tree to transform.
 * @returns {unknown} - A sanitized version of the input with native JavaScript types.
 * 
 * @example
 * toPlain({ _id: { $oid: "..." }, count: { $numberInt: "10" } })
 * // returns { _id: "...", count: 10 }
 */
export function toPlain(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v

  if (Array.isArray(v)) {
    return v.map(item => toPlain(item))
  }

  if (isBsonOid(v)) return String(v.$oid)
  if (isBsonDate(v)) {
    const d = v.$date
    const date = new Date(d)
    return isNaN(date.getTime()) ? new Date() : date
  }
  if (isBsonNumberInt(v)) return Number(v.$numberInt)
  if (isBsonNumberLong(v)) return Number(v.$numberLong)
  if (isBsonNumberDouble(v)) return Number(v.$numberDouble)

  // Recursively process objects
  const obj = v as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key in obj) {
    if (!Object.hasOwn(obj, key)) continue
    result[key] = toPlain(obj[key])
  }
  return result
}

/**
 * Safely extracts a canonical string identifier from a variety of MongoDB-like formats.
 * 
 * This polymorphic utility handles:
 * 1. **Strings**: Returned as-is.
 * 2. **BSON Objects**: Extracts the `$oid` property.
 * 3. **Document Objects**: Extracts `id` or recursively looks into `_id`.
 * 4. **Custom Objects**: Utilizes `toString()` if it provides a non-generic value.
 * 5. **Driver ObjectId**: Uses `toHexString()` when available.
 * 
 * @param {unknown} v - The source value to extract an ID from.
 * @returns {string | undefined} - The resolved string ID, or undefined if no valid identifier could be found.
 * 
 * @example
 * extractId({ _id: { $oid: "507f1f77bcf86cd799439011" } }) // "507f1f77bcf86cd799439011"
 * extractId("507f1f77bcf86cd799439011") // "507f1f77bcf86cd799439011"
 */
export function extractId(v: unknown): string | undefined {
  if (!v) return undefined
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null) {
    if (isBsonOid(v)) return v.$oid

    const obj = v as Record<string, unknown>
    
    // If it's a string 'id', return it
    if (typeof obj.id === 'string') return obj.id

    // If it has toHexString (ObjectId), use it
    if (typeof obj.toHexString === 'function') {
      return (obj.toHexString as () => string)()
    }

    // If it has _id, recurse but avoid circular reference
    if (obj._id && obj._id !== v) return extractId(obj._id)

    if (typeof obj.toString === 'function') {
      const s = obj.toString()
      if (s !== '[object Object]') return s
    }
  }
  return undefined
}









