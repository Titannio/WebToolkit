/**
 * @module location.utils
 * @description Generic location formatting and manipulation utilities.
 */

/**
 * @description Formats city and state into a standard string, allowing an optional mask.
 * 
 * @param {string} city - The name of the city.
 * @param {string} state - The state abbreviation or name.
 * @param {string} [mask='{city}/{state}'] - Optional mask for the output. Use '{city}' and '{state}' as placeholders.
 * @returns {string} - Formatted city/state string.
 * @throws {Error} - If city or state are empty strings.
 * 
 * @example
 * formatCityState('New York', 'NY') // "New York/NY"
 * formatCityState('Seattle', 'WA', '{city} - {state}') // "Seattle - WA"
 */
export function formatCityState(
  city: string,
  state: string,
  mask: string = '{city}/{state}'
): string {
  if (!city) throw new Error('City is required for formatCityState')
  if (!state) throw new Error('State is required for formatCityState')

  return mask.replace('{city}', city).replace('{state}', state)
}

/**
 * @description Formats neighborhood, city, and state into a comprehensive location string.
 * 
 * @param {string} neighborhood - The neighborhood name.
 * @param {string} city - The city name.
 * @param {string} state - The state abbreviation or name.
 * @param {string} [mask='{neighborhood} - {city}/{state}'] - Optional mask for the output. Use '{neighborhood}', '{city}' and '{state}' as placeholders.
 * @returns {string} - Formatted location string.
 * @throws {Error} - If neighborhood, city or state are empty strings.
 * 
 * @example
 * formatNeighborhoodCityState('Downtown', 'New York', 'NY') // "Downtown - New York/NY"
 * formatNeighborhoodCityState('Capitol Hill', 'Seattle', 'WA', '{neighborhood} in {city} ({state})') // "Capitol Hill in Seattle (WA)"
 */
export function formatNeighborhoodCityState(
  neighborhood: string,
  city: string,
  state: string,
  mask: string = '{neighborhood} - {city}/{state}'
): string {
  if (!neighborhood) throw new Error('Neighborhood is required for formatNeighborhoodCityState')
  if (!city) throw new Error('City is required for formatNeighborhoodCityState')
  if (!state) throw new Error('State is required for formatNeighborhoodCityState')

  return mask
    .replace('{neighborhood}', neighborhood)
    .replace('{city}', city)
    .replace('{state}', state)
}

/**
 * Geographic coordinate tuple in GeoJSON format: `[longitude, latitude]`.
 *
 * - Longitude range: `[-180, 180]`
 * - Latitude range: `[-90, 90]`
 */
export type GeoPointCoordinates = [number, number]

/**
 * Minimal GeoJSON Point structure used by the project.
 *
 * Note: this type represents only the fields required for validation.
 */
export type GeoPoint = {
  type: 'Point'
  coordinates: GeoPointCoordinates
}

/**
 * Validate a value that may contain geographic coordinates.
 *
 * Accepted formats:
 * - Tuple/array: `[longitude, latitude]`
 * - GeoJSON Point: `{ type: 'Point', coordinates: [longitude, latitude] }`
 *
 * @param {GeoPoint | GeoPointCoordinates | number[] | null | undefined} value - Value to validate.
 * @returns {boolean} `true` when the value represents a valid point.
 */
export function isValidGeoPointCoordinates(
  value: GeoPoint | GeoPointCoordinates | number[] | null | undefined
): boolean {
  if (value == null || value === undefined) return false

  const coordinates = resolveGeoPointCoordinates(value)
  if (!coordinates) return false

  const [longitude, latitude] = coordinates
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false

  return longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90
}

/**
 * Normalize coordinates from supported input formats.
 *
 * @param {GeoPoint | GeoPointCoordinates | number[]} value - Input value.
 * @returns {GeoPointCoordinates | null} Normalized coordinates, or `null` when invalid.
 */
export function resolveGeoPointCoordinates(
  value: GeoPoint | GeoPointCoordinates | number[]
): GeoPointCoordinates | null {
  if (Array.isArray(value)) {
    const [longitude, latitude, ...rest] = value
    if (rest.length > 0) return null
    if (typeof longitude !== 'number' || typeof latitude !== 'number') return null
    return [longitude, latitude]
  }

  if (!value || typeof value !== 'object' || value.type !== 'Point' || !Array.isArray(value.coordinates)) return null
  const [longitude, latitude, ...rest] = value.coordinates
  if (rest.length > 0) return null
  if (typeof longitude !== 'number' || typeof latitude !== 'number') return null
  return [longitude, latitude]
}
