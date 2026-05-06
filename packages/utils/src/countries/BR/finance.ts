/**
 * @module brazilian-finance.utils
 * @description Financial utilities specific to the Brazilian market.
 */

import { formatCurrency, FormatCurrencyOptions, parseCurrency } from '../../finance/currency.js';

/**
 * Minimal keyboard-event shape used by currency key guards.
 */
export interface KeyboardGuardEvent {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  preventDefault: () => void
}

/**
 * Formats a numeric or string value into a Brazilian Real (BRL) currency string.
 * 
 * @param {number | string | undefined | null} value - The numeric or string value to format.
 * @param {FormatCurrencyOptions} [options={}] - Optional formatting configuration (overrides BRL defaults).
 * @returns {string} - A string formatted as BRL (e.g., "R$ 1.234,56").
 * @throws {BadRequestError} - If the value is null, undefined, or an invalid number.
 * 
 * @example
 * formatCurrencyBRL(1234.56) // returns "R$ 1.234,56"
 */
export function formatCurrencyBRL(
  value: number | string | undefined | null,
  options: FormatCurrencyOptions = {}
): string {
  return formatCurrency(value, {
    currency: 'BRL',
    locale: 'pt-BR',
    ...options,
  });
}

/**
 * Converts a string in Brazilian Real (BRL) format (pt-BR) to a numeric value.
 * 
 * This transformation removes dots used as thousand separators and replaces 
 * the comma decimal separator with a dot to ensure compatibility with 
 * standard JavaScript `parseFloat`.
 * 
 * @param {string | undefined | null} v - The monetary value string in Brazilian format (e.g., "1.234,56").
 * @returns {number} - The parsed numeric value.
 * @throws {BadRequestError} - If the input is empty, null, or cannot be parsed.
 * 
 * @example
 * toNumberFromBRL("1.234,56") // returns 1234.56
 * toNumberFromBRL("R$ 1.000") // returns 1000.0
 * 
 * @see {@link parseCurrency} for the generic operation.
 */
export function toNumberFromBRL(v: string | undefined | null): number {
  return parseCurrency(v, 'pt-BR');
}

/**
 * Formats raw text into BRL display with two decimal places.
 * @param {string} raw - Text containing digits and non-numeric characters.
 * @returns {string} - Value in pt-BR format, e.g.: "1.234,56".
 */
export const formatBRL = (raw: string) => {
  const digits = raw.replace(/\D/g, '')
  const number = parseInt(digits || '0', 10)
  const value = number / 100
  return formatCurrencyBRL(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Converts a BRL display string to a number.
 * @param {string} display - Displayed value, e.g.: "1.234,56".
 * @returns {number} - Numeric value; returns 0 if invalid.
 */
export const toNumberBRL = (display: string) => {
  if (!display) return 0
  const n = parseFloat(display.replace(/\./g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

/**
 * Converts a number to a BRL input string with thousands and decimal comma.
 * @param {number} value - Numeric value.
 * @returns {string} - Display in pt-BR, e.g.: "1.234,56".
 */
export const toBRLInput = (value: number) => {
  const fixed = (Number(value) || 0).toFixed(2)
  const [int, dec] = fixed.split('.')
  const intWithDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${intWithDots},${dec}`
}

/**
 * Restricts allowed keys for currency fields.
 * @param {KeyboardGuardEvent} e - Keyboard-like event.
 * @returns {void}
 */
export const allowCurrencyKey = (e: KeyboardGuardEvent) => {
  const k = e.key
  const ctrl = e.ctrlKey || e.metaKey
  const allowed = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Enter', ',']
  if (allowed.includes(k)) return
  if (ctrl && ['a', 'c', 'v', 'x'].includes(k.toLowerCase())) return
  if (/^[0-9]$/.test(k)) return
  e.preventDefault()
}
