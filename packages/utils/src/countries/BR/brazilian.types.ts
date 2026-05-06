/**
 * @module brazilian.types
 * @description Type definitions for Brazil-specific entities such as state codes.
 */

/**
 * Canonical list of Brazilian state abbreviations,
 * including all 26 states plus the Federal District (DF).
 */
export const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
] as const

/**
 * Union type of all valid Brazilian state abbreviations from BRAZILIAN_STATES.
 * Ensures strict typing for Brazil state-code fields throughout the codebase.
 */
export type BrazilianState = (typeof BRAZILIAN_STATES)[number]
