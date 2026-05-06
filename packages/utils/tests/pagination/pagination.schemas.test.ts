import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { 
    createPaginationQuerySchema, 
    createPaginatedResponseSchema,
    type PaginationQueryConfig 
} from '@src/pagination/pagination.schemas.js'

describe('Pagination Schemas', () => {
    describe('createPaginationQuerySchema', () => {
        describe('with default configuration', () => {
            const schema = createPaginationQuerySchema()

            it('should accept valid pagination parameters', () => {
                const result = schema.parse({ page: 1, limit: 10 })
                expect(result).toEqual({ page: 1, limit: 10 })
            })

            it('should apply default values when parameters are missing', () => {
                const result = schema.parse({})
                expect(result).toEqual({ page: 1, limit: 10 })
            })

            it('should coerce string values to numbers', () => {
                const result = schema.parse({ page: '2', limit: '20' })
                expect(result).toEqual({ page: 2, limit: 20 })
            })

            it('should enforce minimum page value of 1', () => {
                expect(() => schema.parse({ page: 0, limit: 10 })).toThrow()
                expect(() => schema.parse({ page: -1, limit: 10 })).toThrow()
            })

            it('should enforce minimum limit value of 1', () => {
                expect(() => schema.parse({ page: 1, limit: 0 })).toThrow()
                expect(() => schema.parse({ page: 1, limit: -1 })).toThrow()
            })

            it('should enforce default maximum limit of 100', () => {
                const result = schema.parse({ page: 1, limit: 100 })
                expect(result.limit).toBe(100)
                
                expect(() => schema.parse({ page: 1, limit: 101 })).toThrow()
            })

            it('should reject non-integer values', () => {
                expect(() => schema.parse({ page: 1.5, limit: 10 })).toThrow()
                expect(() => schema.parse({ page: 1, limit: 10.5 })).toThrow()
            })
        })

        describe('with custom configuration', () => {
            it('should respect custom maxLimit', () => {
                const config: PaginationQueryConfig = { maxLimit: 1000 }
                const schema = createPaginationQuerySchema(config)

                const result = schema.parse({ page: 1, limit: 1000 })
                expect(result.limit).toBe(1000)

                expect(() => schema.parse({ page: 1, limit: 1001 })).toThrow()
            })

            it('should respect custom defaultPage', () => {
                const config: PaginationQueryConfig = { defaultPage: 2 }
                const schema = createPaginationQuerySchema(config)

                const result = schema.parse({ limit: 10 })
                expect(result.page).toBe(2)
            })

            it('should respect custom defaultLimit', () => {
                const config: PaginationQueryConfig = { defaultLimit: 25 }
                const schema = createPaginationQuerySchema(config)

                const result = schema.parse({ page: 1 })
                expect(result.limit).toBe(25)
            })

            it('should handle all custom config options together', () => {
                const config: PaginationQueryConfig = {
                    defaultPage: 3,
                    defaultLimit: 50,
                    maxLimit: 500
                }
                const schema = createPaginationQuerySchema(config)

                const result = schema.parse({})
                expect(result).toEqual({ page: 3, limit: 50 })

                const maxResult = schema.parse({ page: 1, limit: 500 })
                expect(maxResult.limit).toBe(500)
            })
        })

        describe('user pagination scenario (maxLimit: 100)', () => {
            const schema = createPaginationQuerySchema({
                maxLimit: 100,
                defaultLimit: 10
            })

            it('should allow limits up to 100', () => {
                const result = schema.parse({ page: 1, limit: 100 })
                expect(result.limit).toBe(100)
            })

            it('should reject limits above 100', () => {
                expect(() => schema.parse({ page: 1, limit: 101 })).toThrow()
            })
        })

        describe('admin pagination scenario (maxLimit: 1000)', () => {
            const schema = createPaginationQuerySchema({
                maxLimit: 1000,
                defaultLimit: 10
            })

            it('should allow limits up to 1000', () => {
                const result = schema.parse({ page: 1, limit: 1000 })
                expect(result.limit).toBe(1000)
            })

            it('should reject limits above 1000', () => {
                expect(() => schema.parse({ page: 1, limit: 1001 })).toThrow()
            })
        })
    })

    describe('createPaginatedResponseSchema', () => {
        const itemSchema = z.object({
            id: z.string(),
            name: z.string(),
        })

        const schema = createPaginatedResponseSchema(itemSchema)

        it('should validate a complete paginated response', () => {
            const response = {
                data: [
                    { id: '1', name: 'Item 1' },
                    { id: '2', name: 'Item 2' },
                ],
                total: 100,
                page: 1,
                limit: 10,
                totalPages: 10,
                hasNextPage: true,
                hasPrevPage: false,
            }

            const result = schema.parse(response)
            expect(result).toEqual(response)
        })

        it('should validate empty data array', () => {
            const response = {
                data: [],
                total: 0,
                page: 1,
                limit: 10,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: false,
            }

            const result = schema.parse(response)
            expect(result).toEqual(response)
        })

        it('should validate items against the provided schema', () => {
            const response = {
                data: [{ id: '1', name: 'Valid Item' }],
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1,
                hasNextPage: false,
                hasPrevPage: false,
            }

            expect(() => schema.parse(response)).not.toThrow()
        })

        it('should reject invalid items', () => {
            const response = {
                data: [{ id: 1, name: 'Invalid Item' }], // id should be string
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1,
                hasNextPage: false,
                hasPrevPage: false,
            }

            expect(() => schema.parse(response)).toThrow()
        })

        it('should reject response missing required fields', () => {
            const incompleteResponse = {
                data: [{ id: '1', name: 'Item' }],
                total: 1,
                // Missing: page, limit, totalPages, hasNextPage, hasPrevPage
            }

            expect(() => schema.parse(incompleteResponse)).toThrow()
        })

        it('should reject response with wrong field types', () => {
            const invalidResponse = {
                data: [{ id: '1', name: 'Item' }],
                total: '100', // should be number
                page: 1,
                limit: 10,
                totalPages: 10,
                hasNextPage: true,
                hasPrevPage: false,
            }

            expect(() => schema.parse(invalidResponse)).toThrow()
        })

        it('should handle complex item schemas', () => {
            const complexItemSchema = z.object({
                id: z.string(),
                name: z.string(),
                metadata: z.object({
                    createdAt: z.string(),
                    updatedAt: z.string(),
                }),
                tags: z.array(z.string()),
            })

            const complexSchema = createPaginatedResponseSchema(complexItemSchema)

            const response = {
                data: [
                    {
                        id: '1',
                        name: 'Complex Item',
                        metadata: {
                            createdAt: '2024-01-01',
                            updatedAt: '2024-01-02',
                        },
                        tags: ['tag1', 'tag2'],
                    },
                ],
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1,
                hasNextPage: false,
                hasPrevPage: false,
            }

            const result = complexSchema.parse(response)
            expect(result).toEqual(response)
        })

        it('should validate pagination metadata correctly', () => {
            const response = {
                data: [{ id: '1', name: 'Item' }],
                total: 25,
                page: 2,
                limit: 10,
                totalPages: 3,
                hasNextPage: true,
                hasPrevPage: true,
            }

            const result = schema.parse(response)
            expect(result.hasNextPage).toBe(true)
            expect(result.hasPrevPage).toBe(true)
            expect(result.totalPages).toBe(3)
        })

        it('should handle last page correctly', () => {
            const response = {
                data: [{ id: '1', name: 'Item' }],
                total: 25,
                page: 3,
                limit: 10,
                totalPages: 3,
                hasNextPage: false,
                hasPrevPage: true,
            }

            const result = schema.parse(response)
            expect(result.hasNextPage).toBe(false)
            expect(result.hasPrevPage).toBe(true)
        })

        it('should handle first page correctly', () => {
            const response = {
                data: [{ id: '1', name: 'Item' }],
                total: 25,
                page: 1,
                limit: 10,
                totalPages: 3,
                hasNextPage: true,
                hasPrevPage: false,
            }

            const result = schema.parse(response)
            expect(result.hasNextPage).toBe(true)
            expect(result.hasPrevPage).toBe(false)
        })
    })

    describe('integration scenarios', () => {
        it('should work together for a complete pagination flow', () => {
            // Create query schema
            const querySchema = createPaginationQuerySchema({
                maxLimit: 100,
                defaultLimit: 10
            })

            // Parse query parameters
            const queryParams = querySchema.parse({ page: '2', limit: '20' })
            expect(queryParams).toEqual({ page: 2, limit: 20 })

            // Create response schema
            const itemSchema = z.object({ id: z.string(), name: z.string() })
            const responseSchema = createPaginatedResponseSchema(itemSchema)

            // Validate response
            const response = {
                data: Array.from({ length: 20 }, (_, i) => ({
                    id: String(i + 21),
                    name: `Item ${i + 21}`
                })),
                total: 100,
                page: queryParams.page,
                limit: queryParams.limit,
                totalPages: 5,
                hasNextPage: true,
                hasPrevPage: true,
            }

            const validatedResponse = responseSchema.parse(response)
            expect(validatedResponse.data).toHaveLength(20)
            expect(validatedResponse.page).toBe(2)
        })
    })
})
