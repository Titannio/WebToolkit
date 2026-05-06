import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { handleAsync, handleController, overrideRequestProperty } from '@src/server/http/express.js'

describe('server/express', () => {
  const callWithoutNext = (handler: (req: Request, res: Response) => Promise<unknown>, req: Request, res: Response) => (
    handler(req, res)
  )

  const createMockReqRes = () => {
    const req = {} as Request
    const res = {} as Response
    const next = vi.fn() as unknown as NextFunction
    return { req, res, next }
  }

  describe('handleAsync', () => {
    it('calls the wrapped function', async () => {
      const { req, res, next } = createMockReqRes()
      const fn = vi.fn().mockResolvedValue(undefined)
      const wrapped = handleAsync('test context', fn)

      await wrapped(req, res, next)

      expect(fn).toHaveBeenCalledWith(req, res, expect.any(Function))
    })

    it('forwards errors to next with context', async () => {
      const { req, res, next } = createMockReqRes()
      const error = new Error('Original error')
      const fn = vi.fn().mockRejectedValue(error)
      const wrapped = handleAsync('test context', fn)

      await wrapped(req, res, next)

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Original error',
        context: 'test context',
      }))
    })

    it('throws if next is not provided', async () => {
      const req = {} as Request
      const res = {} as Response
      const error = new Error('Manual error')
      const fn = vi.fn().mockRejectedValue(error)
      const wrapped = handleAsync('test context', fn)
      const wrappedWithoutNext = wrapped as unknown as (req: Request, res: Response) => Promise<unknown>

      await expect(callWithoutNext(wrappedWithoutNext, req, res)).rejects.toThrow('Manual error')
      await expect(callWithoutNext(wrappedWithoutNext, req, res)).rejects.toMatchObject({ context: 'test context' })
    })

    it('works with synchronous functions', async () => {
      const { req, res, next } = createMockReqRes()
      const fn = vi.fn().mockReturnValue('sync result')
      const wrapped = handleAsync('test context', fn)

      await wrapped(req, res, next)

      expect(fn).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })

    it('uses a dummy next when next is not provided', async () => {
      const req = {} as Request
      const res = {} as Response
      const fn = vi.fn().mockImplementation((_req, _res, nextArg: NextFunction) => {
        nextArg()
        return Promise.resolve()
      })
      const wrapped = handleAsync('test context', fn)
      const wrappedWithoutNext = wrapped as unknown as (req: Request, res: Response) => Promise<unknown>

      await callWithoutNext(wrappedWithoutNext, req, res)

      expect(fn).toHaveBeenCalled()
    })
  })

  describe('handleController', () => {
    it('wraps specified methods with handleAsync', async () => {
      const controller = {
        method1: vi.fn().mockResolvedValue('ok'),
        method2: vi.fn().mockResolvedValue('ok'),
        other: 'not a function',
      }
      const contextMap = {
        method1: 'Context 1',
        method2: 'Context 2',
      }

      const wrapped = handleController(contextMap, controller)
      expect(wrapped.other).toBe('not a function')

      const { req, res, next } = createMockReqRes()
      await wrapped.method1(req, res, next)
      expect(controller.method1).toHaveBeenCalled()

      const error = new Error('Method 1 error')
      controller.method1.mockRejectedValue(error)
      await wrapped.method1(req, res, next)

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ context: 'Context 1' }))
    })

    it('does not wrap methods not present in the context map', () => {
      const method1 = vi.fn()
      const controller = { method1 }
      const wrapped = handleController({}, controller)
      expect(wrapped.method1).toBe(method1)
    })

    it('does not wrap mapped keys when value is not a handler function', () => {
      const controller = { method1: 'noop' }
      const wrapped = handleController({ method1: 'Context' } as any, controller as any)
      expect(wrapped.method1).toBe('noop')
    })
  })

  describe('overrideRequestProperty', () => {
    it('overrides a property on the request object', () => {
      const req = {
        query: { original: 'value' },
      } as unknown as Request

      overrideRequestProperty(req, 'query', { overriden: 'newValue' })

      expect(req.query).toEqual({ overriden: 'newValue' })
    })

    it('bypasses non-writable getters', () => {
      const req = {} as Request

      Object.defineProperty(req, 'body', {
        get: () => ({ original: 'body' }),
        configurable: true,
      })

      try {
        req.body = { new: 'body' }
      } catch {
        void 0
      }

      overrideRequestProperty(req, 'body', { new: 'body' })

      expect(req.body).toEqual({ new: 'body' })
    })
  })
})
