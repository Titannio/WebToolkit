/**
 * @module finance.utils
 * @description Financial calculation and formatting utilities.
 */

import { BadRequestError } from '../core/errors.js';

/**
 * Configuration options for formatting currency and numeric values.
 */
export interface FormatCurrencyOptions {
  /** 
   * The ISO 4217 currency code (e.g., 'BRL', 'USD'). Defaults to 'USD'.
   * @type {string}
   */
  currency?: string
  /** 
   * The BCP 47 language tag (e.g., 'pt-BR', 'en-US'). Defaults to 'en-US'.
   * @type {string}
   */
  locale?: string
  /** 
   * The minimum number of fraction digits to use. Defaults to 2.
   * @type {number}
   */
  minimumFractionDigits?: number
  /** 
   * The maximum number of fraction digits to use. Defaults to the value of minimumFractionDigits.
   * @type {number}
   */
  maximumFractionDigits?: number
  /** 
   * Whether to include the currency symbol in the output. Defaults to true.
   * @type {boolean}
   */
  showSymbol?: boolean
}

/**
 * Calculates the net value of a transaction after deducting service fees.
 * Ensures the result never drops below 0.
 * 
 * @param {number} amount - The gross transaction amount.
 * @param {number} fee - The specific fee amount to be deducted.
 * @returns {number} - The resulting net value.
 * @throws {BadRequestError} If amount or fee are null or undefined.
 */
export const calculateNetValue = (amount: number, fee: number): number => {
  if (amount === null || amount === undefined || fee === null || fee === undefined) {
    throw new BadRequestError('Amount and fee must not be null or undefined.');
  }
  if (amount <= 0) return 0;
  const result = amount - fee;
  return result > 0 ? result : 0;
};

/**
 * Formats a numeric or string value into a localized currency string using standard Intl.
 * 
 * This function is the primary utility for displaying monetary values throughout the
 * application. It requires a valid number or numeric string.
 * 
 * @param {number | string | undefined | null} value - The numeric or string value to format.
 * @param {FormatCurrencyOptions} [options={}] - Optional formatting configuration.
 * @returns {string} - A formatted currency string.
 * @throws {BadRequestError} If the value is null, undefined, or an invalid number.
 * 
 * @example
 * formatCurrency(1250.5) // "$1,250.50" (default en-US, 2 fraction digits)
 * formatCurrency(1250.5, { currency: 'EUR', locale: 'de-DE' }) // "1.250,50 €"
 */
export function formatCurrency(
  value: number | string | undefined | null,
  options: FormatCurrencyOptions = {}
): string {
  if (value === undefined || value === null) {
    throw new BadRequestError('Currency value must not be null or undefined.');
  }

  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) {
    throw new BadRequestError('Currency value must be a valid number.');
  }

  const currency = options.currency || 'USD'
  const locale = options.locale || 'en-US'
  const minimumFractionDigits = options.minimumFractionDigits ?? 2
  const maximumFractionDigits = options.maximumFractionDigits ?? Math.max(minimumFractionDigits, 2)
  const showSymbol = options.showSymbol ?? true

  return new Intl.NumberFormat(locale, {
    style: showSymbol ? 'currency' : 'decimal',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(num);
}

/**
 * Parses a localized currency string into a numeric value.
 * 
 * This function attempts to remove common currency symbols and formatting
 * based on the provided locale. If parsing fails, it throws a BadRequestError.
 * 
 * @param {string | undefined | null} value - The localized currency string to parse.
 * @param {string} [locale='en-US'] - The locale used for formatting (e.g., "en-US", "pt-BR").
 * @returns {number} - The parsed numeric value.
 * @throws {BadRequestError} If the value is null, empty, or cannot be parsed.
 * 
 * @example
 * parseCurrency("$1,234.56") // returns 1234.56
 * parseCurrency("1.234,56", "pt-BR") // returns 1234.56
 */
export function parseCurrency(value: string | undefined | null, locale: string = 'en-US'): number {
  if (!value || typeof value !== 'string') {
    throw new BadRequestError('Currency input must be a non-empty string.');
  }

  // Remove common currency symbols and whitespace
  const cleanValue = value.replace(/[^\d.,-]/g, '').trim();

  let num: number;
  if (locale === 'pt-BR') {
    // pt-BR: 1.234,56 -> 1234.56
    num = parseFloat(cleanValue.replace(/\./g, '').replace(',', '.'));
  } else {
    // en-US and others: 1,234.56 -> 1234.56
    num = parseFloat(cleanValue.replace(/,/g, ''));
  }

  if (isNaN(num)) {
    throw new BadRequestError(`Could not parse "${value}" as a valid number.`);
  }

  return num;
}









