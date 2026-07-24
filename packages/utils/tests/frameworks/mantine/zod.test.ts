import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { wrapZodSchema } from '@src/frameworks/mantine/zod.js'

describe('frameworks/mantine/zod', () => {
  it('returns a wrapped schema that keeps successful parses intact', () => {
    const schema = z.object({ name: z.string() })
    const wrapped = wrapZodSchema(schema)

    expect(wrapped.safeParse({ name: 'Ana' })).toEqual(schema.safeParse({ name: 'Ana' }))
  })

  it('adds an errors alias for failed parses', () => {
    const schema = z.object({ name: z.string().min(3) })
    const wrapped = wrapZodSchema(schema)
    const result = wrapped.safeParse({ name: 'Al' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.errors).toEqual([
        {
          path: ['name'],
          message: expect.any(String),
        },
      ])
    }
  })

  it('filters unsupported path segments from resolver errors', () => {
    const wrapped = wrapZodSchema({
      safeParse: () => ({
        success: false,
        error: {
          issues: [{ path: ['user', { nested: true }, 0], message: 'invalid' }],
        },
      }),
    } as any)

    const result = wrapped.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.errors[0]?.path).toEqual(['user', 0])
    }
  })
})
