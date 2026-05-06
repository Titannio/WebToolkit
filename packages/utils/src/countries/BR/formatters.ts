/**
 * @module brazilian-formatters.utils
 * @description Real-time input masking and formatting for Brazilian documents, dates, and phone numbers.
 */

import { format, isValid, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { DateInput } from '../../dates/types.js'
import { maskNumber } from '../../text/transformers.js'
import { normalizeBrazilPhoneDigits } from './brazilian-documents.js'

/**
 * Progressively formats an input string into a CPF mask.
 * 
 * The applied mask follows the `000.000.000-00` pattern and limits to 11 digits.
 * Useful for real-time input masking on the frontend.
 * 
 * @param {string} input - Raw text containing digits and potentially non-numeric characters.
 * @returns {string} - A string formatted with dots and a hyphen based on the number of digits.
 * 
 * @example
 * maskCPF('12345678901') // returns "123.456.789-01"
 * maskCPF('123')         // returns "123"
 * 
 * @see {@link formatCPF} in brazilian-documents.ts for final formatting.
 */
export function maskCPF(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 11)

  if (digits.length <= 3) {
    return digits
  } else if (digits.length <= 6) {
    return `${digits.slice(0, 3)}.${digits.slice(3)}`
  } else if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  } else {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
  }
}

/**
 * Formats a document string as a CPF.
 * 
 * @param {string} input - Raw text containing digits and potentially mask characters.
 * @returns {string} - The formatted CPF string.
 * 
 * @see {@link maskCPF}
 */
export function maskDocument(input: string): string {
  return maskCPF(input)
}

/**
 * Progressively formats input using the Brazilian DD/MM/YYYY date mask.
 * 
 * Inserts slashes at the correct indices and limits to 10 characters.
 * Note: This does not validate the semantic value of the date; use `isValidBirthDate` for full validation.
 * 
 * @param {DateInput} input - The date string or Date object to mask.
 * @returns {string} - A string formatted in the DD/MM/YYYY pattern.
 * 
 * @example
 * maskBRDate('15022023') // returns "15/02/2023"
 * maskBRDate(new Date(2023, 1, 15)) // returns "15/02/2023"
 * 
 * @see {@link isValidBirthDate} in date.ts for semantic validation.
 */
export function maskBRDate(input: DateInput): string {
  if (!input) return ''

  if (input instanceof Date) {
    const day = String(input.getDate()).padStart(2, '0')
    const month = String(input.getMonth() + 1).padStart(2, '0')
    const year = input.getFullYear()
    return `${day}/${month}/${year}`
  }

  const digits = String(input).replace(/\D/g, '').slice(0, 8)
  const dd = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  let out = ''
  if (dd) out += dd
  if (mm) out += '/' + mm
  if (yyyy) out += '/' + yyyy
  return out
}

/**
 * Formats a date using the standard Brazilian `dd/MM/yyyy` pattern.
 * 
 * @param {DateInput} date - The date to be formatted (Date object, ISO string, or timestamp).
 * @returns {string} - The formatted date string or "" if invalid.
 * 
 * @example
 * formatDate('2023-05-15') // returns "15/05/2023"
 */
export const formatDate = (date: DateInput): string => {
  if (!date) return ''
  let parsedDate: Date
  if (date instanceof Date) {
    parsedDate = date
  } else if (typeof date === 'string') {
    parsedDate = parseISO(date)
    if (!isValid(parsedDate)) {
      parsedDate = new Date(date)
    }
  } else {
    parsedDate = new Date(date)
  }

  if (!isValid(parsedDate)) return ''

  return format(parsedDate, 'dd/MM/yyyy', { locale: ptBR })
}

/**
 * Progressively formats a phone number using the Brazilian mask.
 * 
 * This formatter handles both landline `(00) 0000-0000`
 * and mobile `(00) 00000-0000` patterns as the user types.
 * 
 * @param {string} input - Raw text containing digits and potentially mask characters.
 * @returns {string} - The formatted phone number string.
 * 
 * @example
 * maskPhoneBR('11987654321') // returns "(11) 98765-4321"
 * maskPhoneBR('1133221122')  // returns "(11) 3322-1122"
 * 
 * @see {@link formatPhone} in brazilian-documents.ts for final formatting.
 */
export function maskPhoneBR(input: string): string {
  if (!input) return ''
  const digits = normalizeBrazilPhoneDigits(input)?.slice(0, 11) ?? ''

  if (digits.length === 0) return ''

  // Mobile pattern: (99) 99999-9999
  if (digits.length > 10) {
    return maskNumber(digits, '(99) 99999-9999')
  }
  // Landline pattern: (99) 9999-9999
  return maskNumber(digits, '(99) 9999-9999')
}
