import { formatCityState } from '../../geo/location.js'

/**
 * @module brazilian-address
 * @description Utilities for formatting Brazilian addresses.
 */

/**
 * Basic address structure for formatting purposes.
 */
export interface BaseAddress {
  street?: string | null
  number?: string | number | null
  complement?: string | null
  neighborhood?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
}

export { formatCityState, formatNeighborhoodCityState } from '../../geo/location.js'

/**
 * Lookup table for Brazilian state names keyed by abbreviation.
 */
export const UF_NAMES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará',
  PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

/**
 * Returns the full name of a Brazilian state given its abbreviation.
 * 
 * @param {string} uf - The two-letter state abbreviation.
 * @returns {string} - The full state name or the original input if not found.
 */
export function getUFName(uf: string): string {
  if (!uf) return '';
  const upper = uf.toUpperCase();
  return UF_NAMES[upper] || uf;
}

/**
 * Formats a full address into a single string.
 * 
 * @param {BaseAddress | null | undefined} address - Partial address object.
 * @returns {string} - The formatted full address string.
 */
export const formatFullAddress = (address: BaseAddress | null | undefined): string => {
  if (!address) return ''

  const street = address.street || ''
  const number = address.number === '0' || address.number === 0 ? 'S/N' : (address.number ? String(address.number) : '')
  const complement = address.complement || ''
  const neighborhood = address.neighborhood || ''
  const city = address.city || ''
  const state = address.state || ''

  const parts: string[] = []

  // Street and Number
  let streetAndNumber = street
  if (number) {
    streetAndNumber += street ? `, ${number}` : number
  }
  if (streetAndNumber) parts.push(streetAndNumber)

  // Complement
  if (complement) parts.push(complement)

  // Neighborhood
  if (neighborhood) parts.push(neighborhood)

  // City and State
  if (city && state) {
    parts.push(formatCityState(city, state))
  } else if (city) {
    parts.push(city)
  } else if (state) {
    parts.push(state)
  }

  return parts.join(' - ')
}

