/**
 * @module mongo.mongoose
 * @description Utilities for MongoDB and Mongoose data normalization.
 */

import mongoose from 'mongoose'
import { normalizeId } from '../../data/json.js'

/**
 * Duck-typed value exposing a Mongoose-like `toObject` method.
 */
export interface MongooseLike {
  toObject: (options?: unknown) => Record<string, unknown>
}

/**
 * Checks whether a value behaves like a Mongoose document.
 *
 * @param {unknown} obj - Value to inspect.
 * @returns {obj is MongooseLike} Type guard result.
 */
export function isMongooseLike(obj: unknown): obj is MongooseLike {
  return (
    !!obj
    && typeof obj === 'object'
    && 'toObject' in obj
    && typeof (obj as { toObject: unknown }).toObject === 'function'
  )
}

/**
 * Recursively normalizes Mongoose documents/ObjectIds into plain JS data.
 *
 * @param {unknown} input - Input value.
 * @returns {T} Normalized output.
 */
export function normalizeMongoose<T = unknown>(input: unknown): T {
  if (input === null || input === undefined) {
    return input as T
  }

  if (Array.isArray(input)) {
    return input.map((item) => normalizeMongoose(item)) as unknown as T
  }

  if (isMongooseLike(input)) {
    return normalizeMongoose(input.toObject())
  }

  if (input instanceof mongoose.Types.ObjectId) {
    return input.toString() as unknown as T
  }

  if (input instanceof Date) {
    return input as unknown as T
  }

  if (typeof input === 'object') {
    let processed = input as Record<string, unknown>

    if ('_id' in processed) {
      processed = normalizeId(processed) as Record<string, unknown>
    }

    const result: Record<string, unknown> = {}
    for (const key in processed) {
      if (Object.hasOwn(processed, key)) {
        result[key] = normalizeMongoose(processed[key])
      }
    }

    return result as T
  }

  return input as T
}

/**
 * Normalizes an array of Mongoose-like values.
 *
 * @param {unknown[]} inputs - Input values.
 * @returns {T[]} Normalized values.
 */
export function normalizeManyMongoose<T = unknown>(inputs: unknown[]): T[] {
  return inputs.map((item) => normalizeMongoose<T>(item))
}

/**
 * Checks whether value is a valid Mongo ObjectId string.
 *
 * @param {string | unknown} id - Candidate id.
 * @returns {boolean} True when valid.
 */
export function isValidObjectId(id: string | unknown): boolean {
  if (typeof id !== 'string') return false
  return mongoose.isValidObjectId(id)
}
