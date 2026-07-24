import { describe, it, expect } from 'vitest'
import {
  extractErrorMessage,
  ErrorCode,
  BusinessError,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
  BadRequestError,
  ConflictError,
  InternalError,
  CaptchaRequiredError,
  isBusinessError,
  isHttpPayloadTooLargeError,
  isNetworkError
} from '@src/core/errors.js'

describe('error utils', () => {
  describe('isBusinessError', () => {
    it('should return true for BusinessError instances', () => {
      expect(isBusinessError(new BusinessError(ErrorCode.BAD_REQUEST, 'test'))).toBe(true)
      expect(isBusinessError(new NotFoundError())).toBe(true)
    })

    it('should return false for standard Error instances', () => {
      expect(isBusinessError(new Error('test'))).toBe(false)
    })

    it('should return false for non-error values', () => {
      expect(isBusinessError(null)).toBe(false)
      expect(isBusinessError({})).toBe(false)
      expect(isBusinessError('error')).toBe(false)
    })
  })

  describe('extractErrorMessage', () => {
    it('should extract message from ApiError-like details array', () => {
      const error = {
        details: [{ message: 'Campo obrigatorio' }],
      }
      expect(extractErrorMessage(error)).toBe('Campo obrigatorio')
    })

    it('should join mixed ApiError-like details array values when first detail has no message', () => {
      const error = {
        details: [42, { message: 'Mensagem 1' }, true],
      }
      expect(extractErrorMessage(error)).toBe('42, Mensagem 1, true')
    })

    it('should extract message from response.data.details', () => {
      const error = {
        response: {
          data: {
            details: 'Detailed error message',
          },
        },
      }
      expect(extractErrorMessage(error)).toBe('Detailed error message')
    })

    it('should extract message from response.data.error', () => {
      const error = {
        response: {
          data: {
            error: 'API error message',
          },
        },
      }
      expect(extractErrorMessage(error)).toBe('API error message')
    })

    it('should extract message from axios-like details array', () => {
      const error = {
        response: {
          data: {
            details: [{ message: 'Erro de validacao' }],
          },
        },
      }
      expect(extractErrorMessage(error)).toBe('Erro de validacao')
    })

    it('should join mixed axios-like details array values when first detail has no message', () => {
      const error = {
        response: {
          data: {
            details: [777, { message: 'Erro 1' }],
          },
        },
      }
      expect(extractErrorMessage(error)).toBe('777, Erro 1')
    })

    it('should extract message from BusinessError object', () => {
      const error = new BusinessError(ErrorCode.BAD_REQUEST, 'Business Logic Error')
      expect(extractErrorMessage(error)).toBe('Business Logic Error')
    })

    it('should extract message from Error object', () => {
      const error = new Error('Standard error message')
      expect(extractErrorMessage(error)).toBe('Standard error message')
    })

    it('should extract message from object with message property', () => {
      const error = { message: 'Object with message' }
      expect(extractErrorMessage(error)).toBe('Object with message')
    })

    it('should extract message from object with non-string message property', () => {
      const error = { message: 123 }
      expect(extractErrorMessage(error)).toBe('123')
    })

    it('should return the error if it is a string', () => {
      expect(extractErrorMessage('Direct string error')).toBe('Direct string error')
    })

    it('should return default message if no message found', () => {
      expect(extractErrorMessage({})).toBe('Unknown error')
      expect(extractErrorMessage(null)).toBe('Unknown error')
      expect(extractErrorMessage(undefined)).toBe('Unknown error')
      expect(extractErrorMessage(123)).toBe('Unknown error')
      expect(extractErrorMessage({ message: undefined })).toBe('Unknown error')
      expect(extractErrorMessage({ response: {} })).toBe('Unknown error')
      expect(extractErrorMessage({ response: { data: {} } })).toBe('Unknown error')
      expect(extractErrorMessage({ response: { data: { details: undefined, error: undefined } } })).toBe('Unknown error')
    })
  })

  describe('isNetworkError', () => {
    it('should detect network-like Error messages', () => {
      expect(isNetworkError(new Error('Network request failed'))).toBe(true)
      expect(isNetworkError(new Error('connection timeout'))).toBe(true)
    })

    it('should detect object messages but ignore strings', () => {
      expect(isNetworkError({ message: 'fetch failed' })).toBe(true)
      expect(isNetworkError('network')).toBe(false)
    })

    it('should support extra hints', () => {
      expect(isNetworkError(new Error('socket hang up'), { extraHints: ['socket'] })).toBe(true)
    })

    it('should return false when message field is not a string', () => {
      expect(isNetworkError({ message: 123 })).toBe(false)
    })
  })

  describe('isHttpPayloadTooLargeError', () => {
    it('should detect payload-too-large errors by direct or response status', () => {
      expect(isHttpPayloadTooLargeError({ status: 413 })).toBe(true)
      expect(isHttpPayloadTooLargeError({ response: { status: 413 } })).toBe(true)
    })

    it('should detect payload-too-large errors by message hints', () => {
      expect(isHttpPayloadTooLargeError(new Error('request entity too large'))).toBe(true)
      expect(isHttpPayloadTooLargeError(new Error('custom limit'), { extraHints: ['custom limit'] })).toBe(true)
    })

    it('should return false for unrelated values', () => {
      expect(isHttpPayloadTooLargeError(new Error('network error'))).toBe(false)
      expect(isHttpPayloadTooLargeError(null)).toBe(false)
    })
  })

  describe('BusinessError classes', () => {
    it('BusinessError should have correct properties', () => {
      const details = { foo: 'bar' }
      const err = new BusinessError(ErrorCode.BAD_REQUEST, 'Msg', details)
      expect(err.code).toBe(ErrorCode.BAD_REQUEST)
      expect(err.message).toBe('Msg')
      expect(err.details).toEqual(details)
      expect(err.name).toBe('BusinessError')
    })

    it('NotFoundError should have correct default message', () => {
      const err = new NotFoundError()
      expect(err.code).toBe(ErrorCode.NOT_FOUND)
      expect(err.message).toBe('Resource not found')
    })

    it('ForbiddenError should have correct default message', () => {
      const err = new ForbiddenError()
      expect(err.code).toBe(ErrorCode.FORBIDDEN)
      expect(err.message).toBe('Access denied')
    })

    it('UnauthorizedError should have correct default message', () => {
      const err = new UnauthorizedError()
      expect(err.code).toBe(ErrorCode.UNAUTHORIZED)
      expect(err.message).toBe('Unauthorized')
    })

    it('BadRequestError should have correct properties', () => {
      const details = { field: 'invalid' }
      const err = new BadRequestError('Bad', details)
      expect(err.code).toBe(ErrorCode.BAD_REQUEST)
      expect(err.message).toBe('Bad')
      expect(err.details).toBe(details)
    })

    it('ConflictError should have correct properties', () => {
      const err = new ConflictError('Duplicate')
      expect(err.code).toBe(ErrorCode.CONFLICT)
      expect(err.message).toBe('Duplicate')
    })

    it('InternalError should have correct default message', () => {
      const err = new InternalError()
      expect(err.code).toBe(ErrorCode.INTERNAL_ERROR)
      expect(err.message).toBe('Internal server error')
    })

    it('CaptchaRequiredError should have correct default message', () => {
      const err = new CaptchaRequiredError()
      expect(err.code).toBe(ErrorCode.CAPTCHA_REQUIRED)
      expect(err.message).toBe('Captcha required')
    })
  })
})









