/**
 * @module mongo.filters
 * @description Shared helpers for constructing MongoDB filter objects.
 */

import mongoose, { isValidObjectId as isValidMongoObjectId } from 'mongoose'

/**
 * Generic mutable Mongo filter object.
 */
type MongoFilter = Record<string, unknown>
/**
 * Generic Mongo query clause object.
 */
type MongoClause = Record<string, unknown>

type RangeCondition = {
  $gte?: number
  $lte?: number
}

/**
 * Options for status-field filtering behavior.
 */
export interface StatusFilterOptions {
  includeDeleted?: boolean
  deletedStatus: string
}

/**
 * Options for string-field filtering behavior.
 */
export interface StringFilterOptions {
  caseInsensitive?: boolean
  exact?: boolean
  regex?: boolean
}

/**
 * Options for free-text search filter behavior.
 */
export interface SearchFilterOptions {
  includeIdFields?: string[]
}

/**
 * Adds inclusive id filter (`$in` or exact ObjectId) to a Mongo filter.
 *
 * @param {MongoFilter} filter - Mutable target filter.
 * @param {string} field - Field name.
 * @param {string | string[] | undefined | null} value - Raw id value(s).
 * @returns {void} No return value.
 */
export function addIdFilter(
  filter: MongoFilter,
  field: string,
  value: string | string[] | undefined | null,
): void {
  if (value === undefined || value === null) return

  if (Array.isArray(value)) {
    const validIds = value
      .filter((item) => item && isValidMongoObjectId(item))
      .map((item) => new mongoose.Types.ObjectId(item))

    if (validIds.length > 0) {
      if (filter[field] && typeof filter[field] === 'object' && !Array.isArray(filter[field])) {
        filter[field] = { ...(filter[field] as MongoClause), $in: validIds }
      } else {
        filter[field] = { $in: validIds }
      }
    } else if (value.length > 0) {
      filter[field] = null
    }

    return
  }

  if (isValidMongoObjectId(value)) {
    filter[field] = new mongoose.Types.ObjectId(value)
    return
  }

  filter[field] = null
}

/**
 * Adds exclusion id filter (`$nin` or `$ne`) to a Mongo filter.
 *
 * @param {MongoFilter} filter - Mutable target filter.
 * @param {string} field - Field name.
 * @param {string | string[] | undefined | null} value - Raw id value(s).
 * @returns {void} No return value.
 */
export function addExcludeIdFilter(
  filter: MongoFilter,
  field: string,
  value: string | string[] | undefined | null,
): void {
  if (value === undefined || value === null) return

  if (Array.isArray(value)) {
    const validIds = value
      .filter((item) => item && isValidMongoObjectId(item))
      .map((item) => new mongoose.Types.ObjectId(item))

    if (validIds.length > 0) {
      if (filter[field] && typeof filter[field] === 'object' && !Array.isArray(filter[field])) {
        filter[field] = { ...(filter[field] as MongoClause), $nin: validIds }
      } else {
        filter[field] = { $nin: validIds }
      }
    }

    return
  }

  if (isValidMongoObjectId(value)) {
    const objectId = new mongoose.Types.ObjectId(value)
    if (filter[field] && typeof filter[field] === 'object' && !Array.isArray(filter[field])) {
      filter[field] = { ...(filter[field] as MongoClause), $ne: objectId }
    } else {
      filter[field] = { $ne: objectId }
    }
  }
}

/**
 * Adds status filtering with optional deleted-status exclusion.
 *
 * @param {MongoFilter} filter - Mutable target filter.
 * @param {string} field - Status field name.
 * @param {string | string[] | undefined | null} status - Status value(s).
 * @param {StatusFilterOptions} options - Status filtering options.
 * @returns {void} No return value.
 */
export function addStatusFilter(
  filter: MongoFilter,
  field: string,
  status: string | string[] | undefined | null,
  options: StatusFilterOptions,
): void {
  const { includeDeleted = false, deletedStatus } = options

  if (!includeDeleted && !status) {
    filter[field] = { $ne: deletedStatus }
  } else if (status) {
    filter[field] = Array.isArray(status) ? { $in: status } : status
  }
}

/**
 * Adds numeric `$gte/$lte` constraints to a field.
 *
 * @param {MongoFilter} filter - Mutable target filter.
 * @param {string} field - Numeric field name.
 * @param {number | string} [min] - Inclusive minimum.
 * @param {number | string} [max] - Inclusive maximum.
 * @returns {void} No return value.
 */
export function addRangeFilter(
  filter: MongoFilter,
  field: string,
  min?: number | string,
  max?: number | string,
): void {
  if (min === undefined && max === undefined) return

  const rangeFilter: RangeCondition = {}
  if (min !== undefined && min !== '') rangeFilter.$gte = Number(min)
  if (max !== undefined && max !== '') rangeFilter.$lte = Number(max)

  if (Object.keys(rangeFilter).length > 0) {
    filter[field] = rangeFilter
  }
}

/**
 * Adds string matching to a field using array/exact/regex strategies.
 *
 * @param {MongoFilter} filter - Mutable target filter.
 * @param {string} field - Target field.
 * @param {string | string[] | undefined | null} value - Input value(s).
 * @param {StringFilterOptions} [options={}] - Matching options.
 * @returns {void} No return value.
 */
export function addStringFilter(
  filter: MongoFilter,
  field: string,
  value: string | string[] | undefined | null,
  options: StringFilterOptions = {},
): void {
  if (value === undefined || value === null || value === '') return

  if (Array.isArray(value)) {
    filter[field] = { $in: value }
  } else if (options.regex) {
    filter[field] = { $regex: value, $options: options.caseInsensitive !== false ? 'i' : '' }
  } else if (options.exact) {
    if (options.caseInsensitive) {
      filter[field] = { $regex: new RegExp(`^${value}$`, 'i') }
    } else {
      filter[field] = value
    }
  } else {
    filter[field] = value
  }
}

/**
 * Adds boolean filtering with tolerant string-to-boolean coercion.
 *
 * @param {MongoFilter} filter - Mutable target filter.
 * @param {string} field - Target field.
 * @param {boolean | string | undefined | null} value - Input value.
 * @returns {void} No return value.
 */
export function addBooleanFilter(
  filter: MongoFilter,
  field: string,
  value: boolean | string | undefined | null,
): void {
  if (value === undefined || value === null || value === '') return
  filter[field] = value === true || value === 'true'
}

/**
 * Adds an `$or` search clause across text fields and optional ObjectId fields.
 *
 * @param {MongoFilter} filter - Mutable target filter.
 * @param {string | undefined | null} search - Search text.
 * @param {string[]} fields - Text fields to query with regex.
 * @param {SearchFilterOptions} [options={}] - Search options.
 * @returns {void} No return value.
 */
export function addSearchFilter(
  filter: MongoFilter,
  search: string | undefined | null,
  fields: string[],
  options: SearchFilterOptions = {},
): void {
  if (!search) return

  const searchRegex = { $regex: search, $options: 'i' }
  const orConditions: MongoClause[] = fields.map((field) => ({ [field]: searchRegex }))

  if (options.includeIdFields && isValidMongoObjectId(search)) {
    const objectId = new mongoose.Types.ObjectId(search)
    options.includeIdFields.forEach((field) => {
      orConditions.push({ [field]: objectId })
    })
  }

  if (orConditions.length > 0) {
    const existingOr = Array.isArray(filter.$or) ? (filter.$or as MongoClause[]) : []
    filter.$or = [...existingOr, ...orConditions]
  }
}
