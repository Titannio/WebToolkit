/**
 * @module brazilian-documents.utils
 * @description Validation and formatting utilities for Brazilian documents (CPF, CNPJ, CEP, Phone).
 */

import { PHONE_TYPE, type PhoneType } from '../../types/phone.js'

/**
 * Regular expression for validating and matching CPF (Cadastro de Pessoas Físicas) format.
 * Format: XXX.XXX.XXX-XX
 * 
 * @see {@link formatCPF} for formatting raw strings to this pattern.
 * @see {@link isValidCPF} for mathematical validation.
 */
export const CPF_MASK_REGEX = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/

/**
 * Regular expression for validating and matching Brazilian birth date format.
 * Format: DD/MM/YYYY
 * 
 * @see {@link isValidBirthDate} in date.ts for semantic validation.
 */
export const BIRTH_DATE_MASK_REGEX = /^\d{2}\/\d{2}\/\d{4}$/

/**
 * Removes all non-digit characters from a string.
 * 
 * This is a fundamental utility for normalizing documents (CPF, CEP) 
 * before storage or mathematical validation.
 * 
 * @param {string | undefined | null} v - The input string to normalize.
 * @returns {string | undefined} - A string containing only digits, or undefined if the input is nullish or the resulting string is empty.
 * 
 * @example
 * normalizeDigits("123.456.789-00") // returns "12345678900"
 * normalizeDigits("abc")            // returns undefined
 * normalizeDigits(null)             // returns undefined
 */
export function normalizeDigits(v: string | undefined | null): string | undefined {
  const s = String(v ?? '').replace(/\D/g, '')
  return s.length ? s : undefined
}

/**
 * Extracts phone digits without inferring country-code or area-code trunk prefixes.
 *
 * Phone inputs are persisted only when they already contain the canonical
 * 10/11 digits expected by the caller.
 */
export function normalizeBrazilPhoneDigits(v: string | undefined | null): string | undefined {
  return normalizeDigits(v)
}

/**
 * Formats a numeric string into a standard CPF (XXX.XXX.XXX-XX) format.
 * 
 * @param {string | undefined | null} v - The raw numeric string or partially formatted CPF.
 * @returns {string | undefined} - The formatted CPF string, or the original normalized digits if it doesn't have 11 characters.
 * 
 * @example
 * formatCPF("12345678900") // returns "123.456.789-00"
 * formatCPF("123")         // returns "123"
 * 
 * @see {@link isValidCPF} for validation.
 * @see {@link CPF_MASK_REGEX} for the resulting pattern.
 */
export function formatCPF(v: string | undefined | null): string | undefined {
  const clean = normalizeDigits(v)
  if (!clean || clean.length !== 11) return clean || undefined
  return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

/**
 * Formats a numeric string into a standard CNPJ (XX.XXX.XXX/XXXX-XX) format.
 * 
 * @param {string | undefined | null} v - The raw numeric string or partially formatted CNPJ.
 * @returns {string | undefined} - The formatted CNPJ string, or the original normalized digits if it doesn't have 14 characters.
 * 
 * @example
 * formatCNPJ("12345678000199") // returns "12.345.678/0001-99"
 * 
 * @see {@link isValidCNPJ} for validation.
 * @see {@link CNPJ_MASK_REGEX} for the resulting pattern.
 */
export function formatCNPJ(v: string | undefined | null): string | undefined {
  const clean = normalizeDigits(v)
  if (!clean || clean.length !== 14) return clean || undefined
  return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}

/**
 * Formats a numeric string into a standard Brazilian CEP (XXXXX-XXX) format.
 * 
 * @param {string | undefined | null} v - The raw numeric string or partially formatted CEP.
 * @returns {string | undefined} - The formatted CEP string, or the original normalized digits if it doesn't have 8 characters.
 * 
 * @example
 * formatCEP("01234567") // returns "01234-567"
 * 
 * @see {@link isValidCEP} for validation.
 */
export function formatCEP(v: string | undefined | null): string | undefined {
  const clean = normalizeDigits(v)
  if (!clean || clean.length !== 8) return clean || undefined
  return clean.replace(/(\d{5})(\d{3})/, '$1-$2')
}

/**
 * Validates if a string is a correctly formatted Brazilian CEP (8 digits).
 * 
 * @param {string} cep - The CEP string to validate.
 * @returns {boolean} - True if the CEP has exactly 8 digits after normalization.
 * 
 * @example
 * isValidCEP("01234-567") // returns true
 * isValidCEP("123")       // returns false
 * 
 * @see {@link formatCEP} for applying the mask.
 */
export function isValidCEP(cep: string): boolean {
  const clean = normalizeDigits(cep)
  return !!clean && clean.length === 8
}

/**
 * Formats a numeric string into a Brazilian phone number format.
 * Supports both mobile (11 digits) and landline (10 digits) formats.
 * 
 * @param {string | undefined | null} v - The raw numeric string or partially formatted phone number.
 * @param {boolean} [isMobile=true] - Whether to prioritize the 11-digit mobile format.
 * @returns {string | undefined} - The formatted phone string (e.g., "(11) 98765-4321"), or the extracted digits if length is unrecognized.
 * 
 * @example
 * formatPhone("11987654321") // returns "(11) 98765-4321"
 * formatPhone("1134567890", false) // returns "(11) 3456-7890"
 */
export function formatPhone(v: string | undefined | null, isMobile: boolean = true): string | undefined {
  const clean = normalizeBrazilPhoneDigits(v)
  if (!clean) return undefined
  if (isMobile && clean.length === 11) {
    return clean.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  }
  if (!isMobile && clean.length === 10) {
    return clean.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  }
  return clean
}

/**
 * Formats a Brazilian phone for UI display, inferring the correct mask when possible.
 *
 * @param {string | undefined | null} v - Raw or partially formatted phone number.
 * @param {PhoneType | string | null} [type] - Optional explicit phone type.
 * @returns {string | undefined} Display-formatted phone string when possible.
 */
export function formatPhoneForDisplay(
  v: string | undefined | null,
  type?: PhoneType | string | null,
): string | undefined {
  const clean = normalizeBrazilPhoneDigits(v)
  if (!clean) return undefined

  if (type === PHONE_TYPE.LANDLINE) {
    return formatPhone(clean, false)
  }

  if (type === PHONE_TYPE.MOBILE) {
    return formatPhone(clean, true)
  }

  if (clean.length === 10) {
    return formatPhone(clean, false)
  }

  if (clean.length === 11) {
    return formatPhone(clean, true)
  }

  return clean
}

/**
 * Validates a CPF (Cadastro de Pessoas Físicas) using the official checksum algorithm.
 * 
 * This function performs a complete mathematical validation, including
 * check digit calculation and verification against known invalid repetitive sequences.
 * 
 * @param {string} cpf - The CPF string to validate (can be masked or raw).
 * @returns {boolean} - True if the CPF is mathematically valid and has correct digits.
 * 
 * @example
 * isValidCPF("123.456.789-09") // returns false (invalid checksum)
 * isValidCPF("111.111.111-11") // returns false (repetitive digits)
 * 
 * @see {@link formatCPF} for formatting.
 * @see {@link CPF_MASK_REGEX} for format validation.
 */
export function isValidCPF(cpf: string): boolean {
  const clean = cpf.replace(/\D/g, '')
  if (clean.length !== 11) return false
  if (/^(\d)\1{10}$/.test(clean)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(clean.charAt(i)) * (10 - i)
  let rest = 11 - (sum % 11)
  const d1 = rest === 10 || rest === 11 ? 0 : rest
  if (d1 !== parseInt(clean.charAt(9))) return false
  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(clean.charAt(i)) * (11 - i)
  rest = 11 - (sum % 11)
  const d2 = rest === 10 || rest === 11 ? 0 : rest
  if (d2 !== parseInt(clean.charAt(10))) return false
  return true
}

/**
 * Validates a CNPJ (Cadastro Nacional da Pessoa Jurídica) using the official checksum algorithm.
 * 
 * Performs mathematical verification of the check digits and ensures
 * the document is not a known invalid repetitive sequence.
 * 
 * @param {string} cnpj - The CNPJ string to validate (can be masked or raw).
 * @returns {boolean} - True if the CNPJ is mathematically valid.
 * 
 * @example
 * isValidCNPJ("12.345.678/0001-95") // returns true (hypothetical)
 * 
 * @see {@link formatCNPJ} for formatting.
 * @see {@link CNPJ_MASK_REGEX} for format validation.
 */
export function isValidCNPJ(cnpj: string): boolean {
  const clean = cnpj.replace(/\D/g, '')
  if (clean.length !== 14) return false
  if (/^(\d)\1{13}$/.test(clean)) return false
  let size = clean.length - 2
  let numbers = clean.substring(0, size)
  const digits = clean.substring(size)
  let sum = 0
  let pos = size - 7
  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--
    if (pos < 2) pos = 9
  }
  let res = sum % 11 < 2 ? 0 : 11 - (sum % 11)
  if (res !== parseInt(digits.charAt(0))) return false
  size = size + 1
  numbers = clean.substring(0, size)
  sum = 0
  pos = size - 7
  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--
    if (pos < 2) pos = 9
  }
  res = sum % 11 < 2 ? 0 : 11 - (sum % 11)
  if (res !== parseInt(digits.charAt(1))) return false
  return true
}





