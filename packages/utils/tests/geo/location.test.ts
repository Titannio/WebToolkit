import { describe, it, expect } from 'vitest'
import { 
  formatCityState, 
  formatNeighborhoodCityState, 
  isValidGeoPointCoordinates, 
  resolveGeoPointCoordinates 
} from '@src/geo/location.js'

describe('Location Utils', () => {
  describe('formatCityState', () => {
    it('should format city and state with default mask', () => {
      expect(formatCityState('New York', 'NY')).toBe('New York/NY')
    })

    it('should format city and state with custom mask', () => {
      expect(formatCityState('Seattle', 'WA', '{city} - {state}')).toBe('Seattle - WA')
    })

    it('should throw error if city is missing', () => {
      expect(() => formatCityState('', 'SP')).toThrow('City is required for formatCityState')
    })

    it('should throw error if state is missing', () => {
      expect(() => formatCityState('New York', '')).toThrow('State is required for formatCityState')
    })
  })

  describe('formatNeighborhoodCityState', () => {
    it('should format neighborhood, city, and state with default mask', () => {
      expect(formatNeighborhoodCityState('Downtown', 'New York', 'NY'))
        .toBe('Downtown - New York/NY')
    })

    it('should format neighborhood, city, and state with custom mask', () => {
      expect(formatNeighborhoodCityState('Capitol Hill', 'Seattle', 'WA', '{neighborhood} in {city} ({state})'))
        .toBe('Capitol Hill in Seattle (WA)')
    })

    it('should throw error if neighborhood is missing', () => {
      expect(() => formatNeighborhoodCityState('', 'New York', 'NY'))
        .toThrow('Neighborhood is required for formatNeighborhoodCityState')
    })

    it('should throw error if city is missing', () => {
      expect(() => formatNeighborhoodCityState('Downtown', '', 'NY'))
        .toThrow('City is required for formatNeighborhoodCityState')
    })

    it('should throw error if state is missing', () => {
      expect(() => formatNeighborhoodCityState('Downtown', 'New York', ''))
        .toThrow('State is required for formatNeighborhoodCityState')
    })
  })

  describe('isValidGeoPointCoordinates', () => {
    it('should return true for valid tuple coordinates', () => {
      expect(isValidGeoPointCoordinates([-46.6333, -23.5505])).toBe(true)
    })

    it('should return true for valid GeoJSON Point', () => {
      expect(isValidGeoPointCoordinates({ type: 'Point', coordinates: [-46.6333, -23.5505] })).toBe(true)
    })

    it('should return true for boundary coordinates', () => {
      expect(isValidGeoPointCoordinates([-180, -90])).toBe(true)
      expect(isValidGeoPointCoordinates([180, 90])).toBe(true)
    })

    it('should return false for null or undefined', () => {
      expect(isValidGeoPointCoordinates(null)).toBe(false)
      expect(isValidGeoPointCoordinates(undefined)).toBe(false)
    })

    it('should return false for invalid coordinates (out of range)', () => {
      expect(isValidGeoPointCoordinates([-181, -23])).toBe(false)
      expect(isValidGeoPointCoordinates([181, -23])).toBe(false)
      expect(isValidGeoPointCoordinates([-46, -91])).toBe(false)
      expect(isValidGeoPointCoordinates([-46, 91])).toBe(false)
    })

    it('should return false for non-numeric coordinates', () => {
      // @ts-expect-error - testing invalid input
      expect(isValidGeoPointCoordinates(['-46', -23])).toBe(false)
      // @ts-expect-error - testing invalid input
      expect(isValidGeoPointCoordinates([-46, 'NaN'])).toBe(false)
    })

    it('should return false for non-finite coordinates', () => {
      expect(isValidGeoPointCoordinates([Infinity, -23])).toBe(false)
      expect(isValidGeoPointCoordinates([-46, NaN])).toBe(false)
    })

    it('should return false for malformed GeoJSON or arrays', () => {
      expect(isValidGeoPointCoordinates([1, 2, 3] as any)).toBe(false)
      expect(isValidGeoPointCoordinates({ type: 'Point', coordinates: [1] } as any)).toBe(false)
      expect(isValidGeoPointCoordinates({ type: 'Point', coordinates: [1, 2, 3] } as any)).toBe(false)
      expect(isValidGeoPointCoordinates({} as any)).toBe(false)
    })
  })

  describe('resolveGeoPointCoordinates', () => {
    it('should resolve from array', () => {
      expect(resolveGeoPointCoordinates([-46, -23])).toEqual([-46, -23])
    })

    it('should resolve from GeoJSON Point', () => {
      expect(resolveGeoPointCoordinates({ type: 'Point', coordinates: [-46, -23] })).toEqual([-46, -23])
    })

    it('should return null for invalid array length', () => {
      expect(resolveGeoPointCoordinates([1] as any)).toBe(null)
      expect(resolveGeoPointCoordinates([1, 2, 3] as any)).toBe(null)
    })

    it('should return null for invalid array types', () => {
      expect(resolveGeoPointCoordinates(['1', 2] as any)).toBe(null)
      expect(resolveGeoPointCoordinates([1, '2'] as any)).toBe(null)
    })

    it('should return null for invalid objects', () => {
      expect(resolveGeoPointCoordinates(null as any)).toBe(null)
      expect(resolveGeoPointCoordinates({} as any)).toBe(null)
      expect(resolveGeoPointCoordinates({ type: 'Point' } as any)).toBe(null)
      expect(resolveGeoPointCoordinates({ type: 'NotAPoint', coordinates: [1, 2] } as any)).toBe(null)
    })

    it('should return null for invalid GeoJSON coordinates length', () => {
      expect(resolveGeoPointCoordinates({ type: 'Point', coordinates: [1] } as any)).toBe(null)
      expect(resolveGeoPointCoordinates({ type: 'Point', coordinates: [1, 2, 3] } as any)).toBe(null)
    })

    it('should return null for invalid GeoJSON coordinates types', () => {
      expect(resolveGeoPointCoordinates({ type: 'Point', coordinates: ['1', 2] } as any)).toBe(null)
      expect(resolveGeoPointCoordinates({ type: 'Point', coordinates: [1, '2'] } as any)).toBe(null)
    })
  })
})
