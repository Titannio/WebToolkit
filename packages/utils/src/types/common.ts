/**
 * @module common.types
 * @description Generic utility types for domain-independent logic.
 */

/**
 * Utility type to create opaque/branded types for domain-specific strings.
 * Helps prevent accidental assignment between different string types.
 * 
 * @template T - The base type (usually string).
 * @template {string} K - The unique brand identifier.
 */
export type Brand<T, K extends string> = T & { readonly __brand: K }

/**
 * Utility type for a generic object.
 * 
 * @type {Record<string, unknown>}
 */
export type AnyObject = Record<string, unknown>;

/**
 * Utility type to allow partial updates on nested objects.
 * Useful for factory functions and partial updates.
 * 
 * @template T - The type to make partial.
 */
export type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>;
} : T;

/**
 * GeoJSON Point structure for geographical coordinates.
 * Follows the standard [longitude, latitude] format.
 */
export interface GeoLocation {
  /** @type {'Point'} - The type of geometry, always 'Point' for simple coordinates. */
  type: 'Point'
  /** @type {[number, number]} - The coordinate pair: [longitude, latitude]. */
  coordinates: [number, number]
}

/**
 * Generic interface for paginated API responses.
 * 
 * @template T - The type of items contained in the results list.
 */
export interface PaginatedResponse<T> {
  /** @type {T[]} - List of items returned for the current page. */
  data: T[]
  /** @type {number} - Total number of items available in the database for this query. */
  total: number
  /** @type {number} - Current page number. */
  page: number
  /** @type {number} - Number of items per page (limit). */
  limit: number
  /** @type {number} - Total number of pages available. */
  totalPages: number
  /** @type {boolean} - Whether there is a next page. */
  hasNextPage: boolean
  /** @type {boolean} - Whether there is a previous page. */
  hasPrevPage: boolean
}

/**
 * Type-only marker used to keep this module in runtime export maps.
 */
export const __commonTypes = true as const
