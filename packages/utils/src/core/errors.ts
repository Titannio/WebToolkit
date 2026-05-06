/**
 * @module error.utils
 * @description Standardized error handling and business error classes.
 */

/**
 * Type guard to check if an unknown error is an instance of BusinessError.
 * 
 * @param {unknown} error - The error to check.
 * @returns {boolean} - True if the error is a BusinessError instance.
 */
export function isBusinessError(error: unknown): error is BusinessError {
  return error instanceof BusinessError;
}

/**
 * Extracts a user-friendly error message from various error formats.
 * 
 * This utility safely traverses complex error objects, including Axios response
 * structures and native JavaScript errors, to retrieve a displayable message.
 * 
 * @param {unknown} error - The error object caught in a try/catch block.
 * @returns {string} - A user-friendly error message string. Defaults to "Unknown error".
 * 
 * @example
 * try {
 *   await api.get('/data')
 * } catch (e) {
 *   const msg = extractErrorMessage(e)
 *   // msg could be "Network Error", "Resource not found", etc.
 * }
 */
export function extractErrorMessage(error: unknown): string {
  // Check if it's an ApiError (a shared custom error class from frontend-shared)
  if (error && typeof error === 'object' && 'details' in error) {
    const details = (error as { details: unknown }).details
    // Handle Zod validation errors (array of { path, message })
    if (Array.isArray(details) && details.length > 0) {
      const firstDetail = details[0]
      if (firstDetail && typeof firstDetail === 'object' && 'message' in firstDetail) {
        return String((firstDetail as { message: unknown }).message)
      }
      return details.map((d) => {
        if (d && typeof d === 'object' && 'message' in d) {
          return (d as { message: unknown }).message
        }
        return String(d)
      }).join(', ')
    }
  }

  const isAxiosLike = (err: unknown): err is { response: { data?: { details?: unknown; error?: unknown } } } => {
    if (!err || typeof err !== 'object') return false
    const candidate = err as Record<string, unknown>
    return (
      'response' in candidate &&
      candidate.response !== null &&
      typeof candidate.response === 'object'
    )
  }

  if (isAxiosLike(error)) {
    const details = error.response.data?.details
    // Handle Zod validation errors (array of { path, message })
    if (Array.isArray(details) && details.length > 0) {
      const firstDetail = details[0]
      if (firstDetail && typeof firstDetail === 'object' && 'message' in firstDetail) {
        return String((firstDetail as { message: unknown }).message)
      }
      return details.map((d) => {
        if (d && typeof d === 'object' && 'message' in d) {
          return (d as { message: unknown }).message
        }
        return String(d)
      }).join(', ')
    }
    if (details !== undefined) return String(details)
    const apiError = error.response.data?.error
    if (apiError !== undefined) return String(apiError)
  }

  if (isBusinessError(error)) {
    return error.message
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const candidate = error as Record<string, unknown>
    const msg = candidate.message
    if (typeof msg === 'string') return msg
    if (msg !== undefined) return String(msg)
  }

  if (typeof error === 'string') return error

  return 'Unknown error'
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    return typeof message === 'string' ? message : ''
  }
  return ''
}

const getErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined

  const directStatus = (error as { status?: unknown }).status
  if (typeof directStatus === 'number') return directStatus

  const response = (error as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : undefined
}

/**
 * Options for message-based network-error detection.
 */
export interface ErrorMessageMatchOptions {
  /** Additional message substrings to consider a match. */
  extraHints?: string[]
}

/**
 * Identifies common network-related errors from thrown client/server errors.
 *
 * @param {unknown} error - Error candidate.
 * @param {ErrorMessageMatchOptions} [options={}] - Additional message hints.
 * @returns {boolean} True when the error message looks network-related.
 */
export function isNetworkError(
  error: unknown,
  { extraHints = [] }: ErrorMessageMatchOptions = {}
): boolean {
  const message = getErrorMessage(error).toLowerCase()
  if (!message) return false

  const hints = ['network', 'fetch', 'connection', 'timeout', ...extraHints]
  return hints.some((hint) => message.includes(hint.toLowerCase()))
}

/**
 * Options for HTTP payload-too-large detection.
 */
export interface HttpPayloadTooLargeErrorOptions {
  /** HTTP status codes that should be treated as payload-too-large errors. */
  statusCodes?: number[]
  /** Additional message substrings to consider a match. */
  extraHints?: string[]
}

/**
 * Identifies HTTP payload-too-large errors by status code or message hints.
 *
 * @param {unknown} error - Error candidate.
 * @param {HttpPayloadTooLargeErrorOptions} [options={}] - Matching options.
 * @returns {boolean} True when the error represents an oversized request payload.
 */
export function isHttpPayloadTooLargeError(
  error: unknown,
  {
    statusCodes = [413],
    extraHints = [],
  }: HttpPayloadTooLargeErrorOptions = {}
): boolean {
  const status = getErrorStatus(error)
  if (status !== undefined && statusCodes.includes(status)) return true

  const message = getErrorMessage(error).toLowerCase()
  if (!message) return false

  const hints = [
    'request entity too large',
    'payload too large',
    'body exceeded',
    'too large',
    ...extraHints,
  ]

  return hints.some((hint) => message.includes(hint.toLowerCase()))
}

/**
 * Standard error codes used across the business logic to identify specific failure scenarios.
 * 
 * These codes are used by the frontend to provide localized feedback and by the
 * backend to ensure consistent error reporting.
 */
export enum ErrorCode {
  /** The requested resource was not found in the database or storage. */
  NOT_FOUND = 'NOT_FOUND',
  /** The user is authenticated but lacks the necessary permissions for the operation. */
  FORBIDDEN = 'FORBIDDEN',
  /** Authentication is required or the provided credentials/token are invalid. */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /** The request parameters or body fail validation or are malformed. */
  BAD_REQUEST = 'BAD_REQUEST',
  /** The operation would violate a system constraint, such as a unique field requirement. */
  CONFLICT = 'CONFLICT',
  /** An unhandled exception occurred within the server's execution context. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  /** The request is understood but cannot be processed due to semantic errors. */
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
  /** Verification is required via a captcha challenge to proceed. */
  CAPTCHA_REQUIRED = 'CAPTCHA_REQUIRED',
}

/**
 * Base class for all business-related errors in the system.
 * 
 * Provides a structured way to propagate domain-specific errors with
 * machine-readable codes and optional debugging metadata.
 * 
 * @see {@link ErrorCode}
 */
export class BusinessError extends Error {
  /**
   * Initializes a new instance of BusinessError.
   * 
   * @param {ErrorCode} code - The predefined error code identifying the failure scenario.
   * @param {string} message - A descriptive, human-readable error message.
   * @param {unknown} [details] - Optional additional metadata or validation errors for debugging.
   */
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'BusinessError'
  }
}
/**
 * Thrown when a requested resource (e.g., User) cannot be found.
 * HTTP 404
 * 
 * @example
 * if (!user) throw new NotFoundError('User not found');
 */
export class NotFoundError extends BusinessError {
  /**
   * @param {string} [message='Resource not found'] - Custom error message.
   */
  constructor(message: string = 'Resource not found') {
    super(ErrorCode.NOT_FOUND, message)
  }
}

/**
 * Thrown when an authenticated user attempts an unauthorized action.
 * 
 * @example
 * if (user.role !== 'admin') throw new ForbiddenError();
 */
export class ForbiddenError extends BusinessError {
  /**
   * @param {string} [message='Access denied'] - Custom error message.
   */
  constructor(message: string = 'Access denied') {
    super(ErrorCode.FORBIDDEN, message)
  }
}

/**
 * Thrown when session credentials are missing, expired, or otherwise invalid.
 * 
 * @example
 * if (!token) throw new UnauthorizedError('Session expired');
 */
export class UnauthorizedError extends BusinessError {
  /**
   * @param {string} [message='Unauthorized'] - Custom error message.
   */
  constructor(message: string = 'Unauthorized') {
    super(ErrorCode.UNAUTHORIZED, message)
  }
}

/**
 * Thrown when request validation fails or business rules are violated.
 * 
 * @example
 * throw new BadRequestError('Invalid email', { field: 'email' });
 */
export class BadRequestError extends BusinessError {
  /**
   * @param {string} message - Descriptive error message explaining the validation failure.
   * @param {unknown} [details] - Optional validation details, schema errors, or metadata.
   */
  constructor(message: string, details?: unknown) {
    super(ErrorCode.BAD_REQUEST, message, details)
  }
}

/**
 * Thrown when an operation conflicts with the current server state.
 * 
 * Common use cases include duplicate unique identifiers or state transitions
 * that are no longer valid.
 * 
 * @example
 * throw new ConflictError('This email is already in use');
 */
export class ConflictError extends BusinessError {
  /**
   * @param {string} message - Descriptive error message explaining the conflict.
   */
  constructor(message: string) {
    super(ErrorCode.CONFLICT, message)
  }
}

/**
 * Thrown when an unexpected error occurs during server-side processing.
 * 
 * @example
 * try { ... } catch (e) { throw new InternalError('Processing failed', e); }
 */
export class InternalError extends BusinessError {
  /**
   * @param {string} [message='Internal server error'] - Descriptive error message.
   * @param {unknown} [details] - Optional metadata or original error stack for debugging.
   */
  constructor(message: string = 'Internal server error', details?: unknown) {
    super(ErrorCode.INTERNAL_ERROR, message, details)
  }
}

/**
 * Thrown when a secure operation requires a successful captcha verification.
 * 
 * @example
 * if (needsCaptcha) throw new CaptchaRequiredError();
 */
export class CaptchaRequiredError extends BusinessError {
  /**
   * @param {string} [message='Captcha required'] - Descriptive error message.
   */
  constructor(message: string = 'Captcha required') {
    super(ErrorCode.CAPTCHA_REQUIRED, message)
  }
}
