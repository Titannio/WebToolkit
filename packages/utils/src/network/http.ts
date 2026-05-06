/**
 * @module http.utils
 * @description Generic network helpers for fetch-based requests.
 */

export interface FetchWithTimeoutOptions {
  /** Timeout duration in milliseconds. */
  timeoutMs?: number
}

/**
 * Fetches a resource and aborts the request if it exceeds the configured timeout.
 *
 * @param {RequestInfo | URL} input - Fetch input.
 * @param {RequestInit} [init={}] - Fetch init options.
 * @param {FetchWithTimeoutOptions} [options={}] - Timeout options.
 * @returns {Promise<Response>} Fetch response.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  { timeoutMs = 5000 }: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const upstreamSignal = init.signal

  const abortFromUpstream = () => controller.abort()
  if (upstreamSignal?.aborted) {
    controller.abort()
  } else {
    upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true })
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
    upstreamSignal?.removeEventListener('abort', abortFromUpstream)
  }
}









