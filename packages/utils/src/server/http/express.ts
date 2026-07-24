/**
 * @module server.express
 * @description Express-specific server helpers.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express'

/**
 * Error shape that can carry an additional execution context message.
 */
export interface ContextualError extends Error {
  context?: string
}

/**
 * Request-like type with unknown-typed params/query/body.
 *
 * @typedef {Omit<Request, 'params' | 'query' | 'body'> & { params: unknown; query: unknown; body: unknown }} RequestLike
 */
type RequestLike = Omit<Request, 'params' | 'query' | 'body'> & {
  params: unknown
  query: unknown
  body: unknown
}

type AsyncExpressHandler<TReq extends RequestLike = Request> = (
  req: TReq,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown

type ControllerLike = Record<string, AsyncExpressHandler | unknown>

type ControllerMethodKeys<T extends ControllerLike> = {
  [K in keyof T]: T[K] extends AsyncExpressHandler ? K : never
}[keyof T]

/**
 * Type guard for async express handler functions.
 *
 * @param {unknown} value - Candidate value.
 * @returns {value is AsyncExpressHandler} True when handler-like.
 */
const isAsyncExpressHandler = (value: unknown): value is AsyncExpressHandler => typeof value === 'function'

/**
 * Wraps async handlers to attach contextual errors and forward via `next`.
 *
 * @param {string} message - Context message.
 * @param {AsyncExpressHandler<TReq>} fn - Async handler.
 * @returns {RequestHandler} Wrapped handler.
 */
export function handleAsync<TReq extends RequestLike = Request>(
  message: string,
  fn: AsyncExpressHandler<TReq>,
): RequestHandler {
  return (async (req: TReq, res: Response, next?: NextFunction) => {
    try {
      const dummyNext: NextFunction = () => undefined
      await fn(req, res, next ?? dummyNext)
    } catch (error) {
      const contextualError = error as ContextualError
      contextualError.context = message

      if (next) {
        next(contextualError)
      } else {
        throw contextualError
      }
    }
  }) as RequestHandler
}

/**
 * Wraps selected controller methods with contextual async handling.
 *
 * @param {Partial<Record<ControllerMethodKeys<T>, string>>} contextMap - Method context mapping.
 * @param {T} controller - Controller object.
 * @returns {T} Wrapped controller.
 */
export const handleController = <T extends ControllerLike>(
  contextMap: Partial<Record<ControllerMethodKeys<T>, string>>,
  controller: T,
): T => {
  const wrapped = { ...controller }

  for (const key of Object.keys(contextMap) as ControllerMethodKeys<T>[]) {
    const contextMessage = contextMap[key]
    const originalMethod = controller[key]

    if (contextMessage && isAsyncExpressHandler(originalMethod)) {
      wrapped[key] = handleAsync(contextMessage, originalMethod) as T[typeof key]
    }
  }

  return wrapped
}

/**
 * Overrides a request property with writable descriptor.
 *
 * @param {Request} req - Express request.
 * @param {keyof Request} key - Property key.
 * @param {unknown} value - New value.
 * @returns {void} No return value.
 */
export const overrideRequestProperty = (req: Request, key: keyof Request, value: unknown): void => {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
}
