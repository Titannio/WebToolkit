/**
 * @module math.utils
 * @description Mathematical utility functions for percentages and ratios.
 */

import { sum, mean } from 'es-toolkit'

/**
 * @description Calculates the percentage of `numerator` over `denominator` and formats with "%" suffix.
 *
 * @param {number} [numerator=0] - Numerator value; treats invalid as 0.
 * @param {number} [denominator=0] - Denominator value; treats invalid/<=0 as 0.
 * @param {number} [digits=2] - Decimal places to display.
 * @returns {string} - Formatted percentage, e.g., "12.34%".
 *
 * @example
 * formatPercentRatio(12, 100) // "12.00%"
 */
export function formatPercentRatio(numerator: number = 0, denominator: number = 0, digits: number = 2): string {
  const n = typeof numerator === 'number' && isFinite(numerator) ? numerator : 0
  const d = typeof denominator === 'number' && isFinite(denominator) && denominator > 0 ? denominator : 0
  if (!d || !n) return (0).toFixed(digits) + '%'
  const pct = (n / d) * 100
  return pct.toFixed(digits) + '%'
}

export { sum, mean }








