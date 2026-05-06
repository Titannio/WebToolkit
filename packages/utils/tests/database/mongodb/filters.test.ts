import { describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import {
  addBooleanFilter,
  addExcludeIdFilter,
  addIdFilter,
  addRangeFilter,
  addSearchFilter,
  addStatusFilter,
  addStringFilter,
} from '@src/database/mongodb/filters.js'

describe('mongo/filters', () => {
  describe('addIdFilter', () => {
    it('adds a single valid ObjectId to the filter', () => {
      const filter: Record<string, unknown> = {}
      const validId = new mongoose.Types.ObjectId().toString()

      addIdFilter(filter, '_id', validId)

      expect(filter._id).toBeInstanceOf(mongoose.Types.ObjectId)
      expect((filter._id as mongoose.Types.ObjectId).toString()).toBe(validId)
    })

    it('sets field to null for a single invalid ObjectId', () => {
      const filter: Record<string, unknown> = {}
      addIdFilter(filter, '_id', 'invalid-id')

      expect(filter._id).toBeNull()
    })

    it('handles an array of valid ObjectIds', () => {
      const filter: Record<string, unknown> = {}
      const id1 = new mongoose.Types.ObjectId().toString()
      const id2 = new mongoose.Types.ObjectId().toString()

      addIdFilter(filter, 'entityId', [id1, id2])

      expect((filter.entityId as { $in: mongoose.Types.ObjectId[] }).$in).toHaveLength(2)
    })

    it('filters out invalid IDs from an array', () => {
      const filter: Record<string, unknown> = {}
      const validId = new mongoose.Types.ObjectId().toString()

      addIdFilter(filter, 'entityId', [validId, 'invalid-one', 'invalid-two'])

      const ids = (filter.entityId as { $in: mongoose.Types.ObjectId[] }).$in
      expect(ids).toHaveLength(1)
      expect(ids[0]?.toString()).toBe(validId)
    })

    it('sets field to null if all ids in the array are invalid', () => {
      const filter: Record<string, unknown> = {}

      addIdFilter(filter, 'entityId', ['invalid-one', 'invalid-two'])

      expect(filter.entityId).toBeNull()
    })

    it('merges with an existing field filter', () => {
      const filter: Record<string, unknown> = { status: { $ne: 'DELETED' } }
      const validId = new mongoose.Types.ObjectId().toString()

      addIdFilter(filter, 'status', [validId])

      expect((filter.status as { $ne: string }).$ne).toBe('DELETED')
      expect(((filter.status as { $in: mongoose.Types.ObjectId[] }).$in)[0]?.toString()).toBe(validId)
    })

    it('does nothing if value is null or undefined', () => {
      const filter: Record<string, unknown> = {}

      addIdFilter(filter, 'entityId', null)
      addIdFilter(filter, 'entityId', undefined)

      expect(filter).toEqual({})
    })

    it('does nothing for empty id arrays', () => {
      const filter: Record<string, unknown> = {}
      addIdFilter(filter, 'entityId', [])
      expect(filter).toEqual({})
    })
  })

  describe('addExcludeIdFilter', () => {
    it('excludes a single id', () => {
      const filter: Record<string, unknown> = {}
      const id = new mongoose.Types.ObjectId().toString()

      addExcludeIdFilter(filter, '_id', id)

      expect(((filter._id as { $ne: mongoose.Types.ObjectId }).$ne).toString()).toBe(id)
    })

    it('excludes an array of ids', () => {
      const filter: Record<string, unknown> = {}
      const id1 = new mongoose.Types.ObjectId().toString()
      const id2 = new mongoose.Types.ObjectId().toString()

      addExcludeIdFilter(filter, '_id', [id1, id2])

      expect((filter._id as { $nin: mongoose.Types.ObjectId[] }).$nin).toHaveLength(2)
    })

    it('merges array exclusion with existing object filters', () => {
      const filter: Record<string, unknown> = { _id: { $in: [] } }
      const id = new mongoose.Types.ObjectId().toString()

      addExcludeIdFilter(filter, '_id', [id])

      expect((filter._id as { $in: unknown[] }).$in).toBeDefined()
      expect((filter._id as { $nin: mongoose.Types.ObjectId[] }).$nin).toHaveLength(1)
    })

    it('merges with existing filters', () => {
      const filter: Record<string, unknown> = { _id: { $in: [] } }
      const id = new mongoose.Types.ObjectId().toString()

      addExcludeIdFilter(filter, '_id', id)

      expect((filter._id as { $in: unknown[] }).$in).toBeDefined()
      expect(((filter._id as { $ne: mongoose.Types.ObjectId }).$ne).toString()).toBe(id)
    })

    it('does nothing if value is null', () => {
      const filter: Record<string, unknown> = {}
      addExcludeIdFilter(filter, '_id', null)
      expect(filter).toEqual({})
    })

    it('does nothing for invalid single ids and empty arrays', () => {
      const filter: Record<string, unknown> = { existing: true }
      addExcludeIdFilter(filter, '_id', 'invalid-id')
      addExcludeIdFilter(filter, '_id', [])
      expect(filter).toEqual({ existing: true })
    })
  })

  describe('addStatusFilter', () => {
    it('adds deleted exclusion by default', () => {
      const filter: Record<string, unknown> = {}
      addStatusFilter(filter, 'status', null, { deletedStatus: 'DELETED' })
      expect((filter.status as { $ne: string }).$ne).toBe('DELETED')
    })

    it('uses the provided status', () => {
      const filter: Record<string, unknown> = {}
      addStatusFilter(filter, 'status', 'ACTIVE', { deletedStatus: 'DELETED' })
      expect(filter.status).toBe('ACTIVE')
    })

    it('uses $in for an array of statuses', () => {
      const filter: Record<string, unknown> = {}
      addStatusFilter(filter, 'status', ['ACTIVE', 'PENDING'], { deletedStatus: 'DELETED' })
      expect((filter.status as { $in: string[] }).$in).toEqual(['ACTIVE', 'PENDING'])
    })

    it('includes deleted if requested', () => {
      const filter: Record<string, unknown> = {}
      addStatusFilter(filter, 'status', null, { includeDeleted: true, deletedStatus: 'DELETED' })
      expect(filter.status).toBeUndefined()
    })
  })

  describe('addRangeFilter', () => {
    it('adds min and max range filters', () => {
      const filter: Record<string, unknown> = {}
      addRangeFilter(filter, 'price', 100, 200)
      expect(filter.price).toEqual({ $gte: 100, $lte: 200 })
    })

    it('handles a partial range', () => {
      const filter: Record<string, unknown> = {}
      addRangeFilter(filter, 'price', 100)
      expect(filter.price).toEqual({ $gte: 100 })
    })

    it('treats empty strings as undefined', () => {
      const filter: Record<string, unknown> = {}
      addRangeFilter(filter, 'price', '', '')
      expect(filter.price).toBeUndefined()
    })

    it('does nothing when both min and max are omitted', () => {
      const filter: Record<string, unknown> = {}
      addRangeFilter(filter, 'price')
      expect(filter).toEqual({})
    })
  })

  describe('addStringFilter', () => {
    it('adds an exact string', () => {
      const filter: Record<string, unknown> = {}
      addStringFilter(filter, 'name', 'test')
      expect(filter.name).toBe('test')
    })

    it('uses $in for arrays', () => {
      const filter: Record<string, unknown> = {}
      addStringFilter(filter, 'name', ['a', 'b'])
      expect(filter.name).toEqual({ $in: ['a', 'b'] })
    })

    it('uses regex when requested', () => {
      const filter: Record<string, unknown> = {}
      addStringFilter(filter, 'name', 'test', { regex: true })
      expect(filter.name).toEqual({ $regex: 'test', $options: 'i' })
    })

    it('uses case-sensitive regex when requested', () => {
      const filter: Record<string, unknown> = {}
      addStringFilter(filter, 'name', 'test', { regex: true, caseInsensitive: false })
      expect(filter.name).toEqual({ $regex: 'test', $options: '' })
    })

    it('uses exact case-insensitive regex', () => {
      const filter: Record<string, unknown> = {}
      addStringFilter(filter, 'name', 'test', { exact: true, caseInsensitive: true })
      expect((filter.name as { $regex: RegExp }).$regex).toEqual(/^test$/i)
    })

    it('uses exact literal match when case-insensitive is false', () => {
      const filter: Record<string, unknown> = {}
      addStringFilter(filter, 'name', 'test', { exact: true, caseInsensitive: false })
      expect(filter.name).toBe('test')
    })

    it('ignores empty-string values', () => {
      const filter: Record<string, unknown> = {}
      addStringFilter(filter, 'name', '')
      expect(filter).toEqual({})
    })
  })

  describe('addBooleanFilter', () => {
    it('adds boolean true', () => {
      const filter: Record<string, unknown> = {}
      addBooleanFilter(filter, 'active', true)
      expect(filter.active).toBe(true)
    })

    it('parses string true', () => {
      const filter: Record<string, unknown> = {}
      addBooleanFilter(filter, 'active', 'true')
      expect(filter.active).toBe(true)
    })

    it('defaults to false for other values', () => {
      const filter: Record<string, unknown> = {}
      addBooleanFilter(filter, 'active', 'random')
      expect(filter.active).toBe(false)
    })

    it('ignores empty strings', () => {
      const filter: Record<string, unknown> = {}
      addBooleanFilter(filter, 'active', '')
      expect(filter).toEqual({})
    })
  })

  describe('addSearchFilter', () => {
    it('adds an $or regex condition for fields', () => {
      const filter: Record<string, unknown> = {}
      addSearchFilter(filter, 'query', ['field1', 'field2'])

      const conditions = filter.$or as Array<Record<string, { $regex: string }>>
      expect(conditions).toHaveLength(2)
      expect(conditions[0]?.field1?.$regex).toBe('query')
    })

    it('includes id fields when the query is a valid ObjectId', () => {
      const filter: Record<string, unknown> = {}
      const id = new mongoose.Types.ObjectId().toString()
      addSearchFilter(filter, id, ['name'], { includeIdFields: ['_id'] })

      const conditions = filter.$or as Array<Record<string, unknown>>
      expect(conditions).toHaveLength(2)
      expect(conditions[1]?._id).toBeInstanceOf(mongoose.Types.ObjectId)
    })

    it('merges with an existing $or array', () => {
      const filter: Record<string, unknown> = { $or: [{ existing: true }] }
      addSearchFilter(filter, 'query', ['name'])

      const conditions = filter.$or as Array<Record<string, unknown>>
      expect(conditions).toHaveLength(2)
      expect(conditions[0]?.existing).toBe(true)
    })

    it('ignores empty queries and empty field arrays', () => {
      const filterA: Record<string, unknown> = {}
      addSearchFilter(filterA, '', ['name'])
      expect(filterA).toEqual({})

      const filterB: Record<string, unknown> = {}
      addSearchFilter(filterB, 'query', [])
      expect(filterB).toEqual({})
    })
  })
})
