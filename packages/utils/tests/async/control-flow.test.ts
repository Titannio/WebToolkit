import { describe, it, expect, vi } from 'vitest'
import { retry, safeJSONParse } from '@src/async/control-flow.js'

describe('Control Flow Utils', () => {
    describe('retry', () => {
        it('should return result if function succeeds immediately', async () => {
            const fn = vi.fn().mockResolvedValue('success')
            const result = await retry(fn, 3, 10)
            expect(result).toBe('success')
            expect(fn).toHaveBeenCalledTimes(1)
        })

        it('should retry if function fails', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail 1'))
                .mockResolvedValue('success')
            
            const result = await retry(fn, 3, 10)
            expect(result).toBe('success')
            expect(fn).toHaveBeenCalledTimes(2)
        })

        it('should throw error if all attempts fail', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('fail'))
            
            await expect(retry(fn, 3, 10)).rejects.toThrow('fail')
            expect(fn).toHaveBeenCalledTimes(3)
        })
    })

    describe('safeJSONParse', () => {
        it('should parse valid JSON', () => {
            const json = '{"key": "value"}'
            expect(safeJSONParse(json, {})).toEqual({ key: 'value' })
        })

        it('should return fallback for invalid JSON', () => {
            const json = '{invalid}'
            expect(safeJSONParse(json, { fallback: true })).toEqual({ fallback: true })
        })

        it('should return fallback for null/undefined input', () => {
            expect(safeJSONParse(null, 'fallback')).toBe('fallback')
            expect(safeJSONParse(undefined, 'fallback')).toBe('fallback')
        })
    })
})









