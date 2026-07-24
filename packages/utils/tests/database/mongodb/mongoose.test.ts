import { describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import {
  isMongooseLike,
  isValidObjectId,
  normalizeManyMongoose,
  normalizeMongoose,
} from '@src/database/mongodb/mongoose.js'

describe('mongo/mongoose', () => {
  describe('isMongooseLike', () => {
    it('detects objects with toObject', () => {
      expect(isMongooseLike({ toObject: () => ({}) })).toBe(true)
      expect(isMongooseLike({})).toBe(false)
    })
  })

  describe('normalizeMongoose', () => {
    it('returns null or undefined as is', () => {
      expect(normalizeMongoose(null)).toBeNull()
      expect(normalizeMongoose(undefined)).toBeUndefined()
    })

    it('converts ObjectId to string', () => {
      const id = new mongoose.Types.ObjectId()
      const result = normalizeMongoose(id)
      expect(result).toBe(id.toString())
      expect(typeof result).toBe('string')
    })

    it('preserves Date objects', () => {
      const date = new Date()
      const result = normalizeMongoose(date)
      expect(result).toBe(date)
      expect(result).toBeInstanceOf(Date)
    })

    it('normalizes objects recursively', () => {
      const id1 = new mongoose.Types.ObjectId()
      const id2 = new mongoose.Types.ObjectId()
      const date = new Date()

      const input = {
        _id: id1,
        name: 'Test',
        nested: {
          _id: id2,
          date,
          list: [id1, id2],
        },
      }

      const result = normalizeMongoose<{
        id: string
        name: string
        nested: {
          id: string
          date: Date
          list: string[]
        }
      }>(input)

      expect(result.id).toBe(id1.toString())
      expect(result.nested.id).toBe(id2.toString())
      expect(result.nested.date).toBe(date)
      expect(result.nested.list).toEqual([id1.toString(), id2.toString()])
    })

    it('handles arrays', () => {
      const id = new mongoose.Types.ObjectId()
      const input = [id, { _id: id }]
      const result = normalizeMongoose<Array<string | { id: string }>>(input)

      expect(result).toHaveLength(2)
      expect(result[0]).toBe(id.toString())
      expect(result[1]).toEqual({ id: id.toString() })
    })

    it('handles Mongoose documents', () => {
      const schema = new mongoose.Schema({ name: String })
      const model = mongoose.model(`Test${Date.now()}`, schema)
      const doc = new model({ name: 'Doc' })

      const result = normalizeMongoose<{ id: string; name: string }>(doc)

      expect(result).not.toBeInstanceOf(mongoose.Document)
      expect(result.name).toBe('Doc')
      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
    })

    it('handles objects without _id', () => {
      const input = { name: 'Test', age: 30 }
      const result = normalizeMongoose<Record<string, unknown>>(input)
      expect(result).toEqual(input)
      expect(result).not.toBe(input)
    })

    it('handles primitives', () => {
      expect(normalizeMongoose('string')).toBe('string')
      expect(normalizeMongoose(123)).toBe(123)
      expect(normalizeMongoose(true)).toBe(true)
    })

    it('ignores properties from the prototype', () => {
      const proto = { protoProp: 'proto' }
      const input = Object.create(proto) as Record<string, unknown>
      input.ownProp = 'own'

      const result = normalizeMongoose<Record<string, unknown>>(input)
      expect(result.ownProp).toBe('own')
      expect(result.protoProp).toBeUndefined()
    })
  })

  describe('normalizeManyMongoose', () => {
    it('normalizes an array of items', () => {
      const id1 = new mongoose.Types.ObjectId()
      const id2 = new mongoose.Types.ObjectId()
      const input = [{ _id: id1 }, { _id: id2 }]

      const result = normalizeManyMongoose<{ id: string }>(input)

      expect(result).toHaveLength(2)
      expect(result[0]?.id).toBe(id1.toString())
      expect(result[1]?.id).toBe(id2.toString())
    })

    it('throws for null or undefined input', () => {
      expect(() => normalizeManyMongoose(null as unknown as unknown[])).toThrow()
      expect(() => normalizeManyMongoose(undefined as unknown as unknown[])).toThrow()
    })
  })

  describe('isValidObjectId', () => {
    it('returns true for a valid ObjectId string', () => {
      const validId = new mongoose.Types.ObjectId().toString()
      expect(isValidObjectId(validId)).toBe(true)
    })

    it('returns false for an invalid ObjectId string', () => {
      expect(isValidObjectId('invalid-id')).toBe(false)
    })

    it('returns false for non-string input', () => {
      expect(isValidObjectId(null)).toBe(false)
      expect(isValidObjectId(undefined)).toBe(false)
      expect(isValidObjectId(123)).toBe(false)
      expect(isValidObjectId({})).toBe(false)
    })
  })
})
