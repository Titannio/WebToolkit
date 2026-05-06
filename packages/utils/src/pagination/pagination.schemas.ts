import { z } from 'zod'
import type { PaginatedResponse } from '../types/common.js'

/**
 * Configuration options for pagination query schema.
 */
export interface PaginationQueryConfig {
  /** Default page number if not provided. Defaults to 1. */
  defaultPage?: number
  /** Default number of items per page. Defaults to 10. */
  defaultLimit?: number
  /** Maximum allowed items per page. Defaults to 100. */
  maxLimit?: number
}

/**
 * Creates a Zod schema for pagination query parameters.
 * 
 * @param {PaginationQueryConfig} [config] - Configuration options for pagination limits and defaults
 * @returns {z.ZodObject<{page: z.ZodDefault<z.ZodNumber>, limit: z.ZodDefault<z.ZodNumber>}>} Zod schema for pagination query parameters
 * 
 * @example
 * ```typescript
 * // Standard user pagination (max 100)
 * const userPaginationSchema = createPaginationQuerySchema({
 *   maxLimit: 100,
 *   defaultLimit: 10
 * })
 * 
 * // Admin pagination (max 1000)
 * const adminPaginationSchema = createPaginationQuerySchema({
 *   maxLimit: 1000,
 *   defaultLimit: 10
 * })
 * ```
 */
export function createPaginationQuerySchema(config?: PaginationQueryConfig) {
  const {
    defaultPage = 1,
    defaultLimit = 10,
    maxLimit = 100
  } = config ?? {}

  return z.object({
    page: z.coerce.number().int().min(1).default(defaultPage),
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
  })
}

/**
 * Creates a Zod schema for paginated API responses.
 * 
 * @template {z.ZodTypeAny} T - The Zod schema type for individual items
 * @param {T} itemSchema - Zod schema for validating each item in the data array
 * @returns {z.ZodType<PaginatedResponse<z.infer<T>>>} Zod schema for the complete paginated response
 * 
 * @example
 * ```typescript
 * const userSchema = z.object({ id: z.string(), name: z.string() })
 * const paginatedUsersSchema = createPaginatedResponseSchema(userSchema)
 * 
 * type PaginatedUsers = z.infer<typeof paginatedUsersSchema>
 * // { data: User[], total: number, page: number, ... }
 * ```
 */
export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(
  itemSchema: T
): z.ZodType<PaginatedResponse<z.infer<T>>> {
  return z.object({
    data: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
    hasNextPage: z.boolean(),
    hasPrevPage: z.boolean(),
  })
}

/**
 * Re-exported pagination response type for schema consumers.
 */
export type { PaginatedResponse }
