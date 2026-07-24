/**
 * @module control-flow.utils
 * @description Control flow utilities for handling retries and safe parsing.
 */

import { retry as esRetry } from 'es-toolkit'

/**
 * Retries an asynchronous function multiple times with a delay between attempts.
 * 
 * @template T - The return type of the function.
 * @param {() => Promise<T>} fn - The function to execute. Must return a Promise.
 * @param {number} attempts - The maximum number of attempts (including the first one).
 * @param {number} delay - The delay in milliseconds between attempts.
 * @returns {Promise<T>} - The result of the function if successful.
 * @throws {unknown} - The error from the last attempt if all attempts fail.
 */
export async function retry<T>(fn: () => Promise<T>, attempts: number, delay: number): Promise<T> {
  return esRetry(fn, {
    retries: Math.max(0, attempts - 1),
    delay
  });
}

/**
 * Safely parses a JSON string, returning a fallback value if parsing fails.
 * 
 * @template T - The type of the value being parsed.
 * @param {string | null | undefined} text - The JSON string to parse.
 * @param {T} fallback - The fallback value to return if parsing fails.
 * @returns {T} - The parsed object/value or the fallback value.
 */
export function safeJSONParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;

  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}


