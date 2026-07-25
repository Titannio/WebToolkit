import { describe, it, expect } from 'vitest'
import { formatCityState, formatFullAddress, formatNeighborhoodCityState, getUFName } from '@src/countries/BR/address.js'

describe('brazilian address', () => {
  it('should format city/state and neighborhood', () => {
    expect(formatCityState('Curitiba', 'PR')).toBe('Curitiba/PR')
    expect(() => formatCityState('Curitiba', '')).toThrow('State is required')
    expect(() => formatCityState('', 'SP')).toThrow('City is required')
    expect(() => formatCityState('', '')).toThrow('City is required')
    expect(formatCityState('Curitiba', 'PR', '{city} - {state}')).toBe('Curitiba - PR')
    expect(formatNeighborhoodCityState('Downtown', 'Curitiba', 'PR'))
      .toBe('Downtown - Curitiba/PR')
    expect(() => formatNeighborhoodCityState('', 'Curitiba', 'PR')).toThrow('Neighborhood is required')
    expect(() => formatNeighborhoodCityState('Downtown', '', 'PR')).toThrow('City is required')
    expect(() => formatNeighborhoodCityState('Downtown', 'Curitiba', '')).toThrow('State is required')
    expect(formatNeighborhoodCityState('Downtown', 'Curitiba', 'PR', '{city} - {neighborhood}')).toBe('Curitiba - Downtown')
  })

  it('should format full address with S/N', () => {
    const formatted = formatFullAddress({
      street: 'Example Street',
      number: 0,
      complement: 'Apartment 1',
      neighborhood: 'Downtown',
      city: 'Curitiba',
      state: 'PR',
    })
    expect(formatted).toContain('Example Street, S/N')
    expect(formatted).toContain('Downtown')
    expect(formatFullAddress(null)).toBe('')
    expect(formatFullAddress({ street: 'Second Street' })).toBe('Second Street')
    expect(formatFullAddress({ number: '0' })).toBe('S/N')
    expect(formatFullAddress({ number: 12 })).toBe('12')
    expect(formatFullAddress({ city: 'Campinas', state: 'SP' })).toBe('Campinas/SP')
    expect(formatFullAddress({ city: 'Campinas' })).toBe('Campinas')
    expect(formatFullAddress({ state: 'SP' })).toBe('SP')
  })

  it('should format full address with various combinations', () => {
    // Street + Number + Complement + Neighborhood + City + State
    expect(formatFullAddress({
      street: 'Example Street',
      number: '123',
      complement: 'Suite 1',
      neighborhood: 'Downtown',
      city: 'Curitiba',
      state: 'PR'
    })).toBe('Example Street, 123 - Suite 1 - Downtown - Curitiba/PR')

    // Street + Complement + City
    expect(formatFullAddress({
      street: 'Example Street',
      complement: 'Rear unit',
      city: 'Curitiba'
    })).toBe('Example Street - Rear unit - Curitiba')

    // Number + Neighborhood + State
    expect(formatFullAddress({
      number: '500',
      neighborhood: 'Garden District',
      state: 'RJ'
    })).toBe('500 - Garden District - RJ')

    // Street + Number (no street)
    expect(formatFullAddress({
      number: '100'
    })).toBe('100')

    // City only
    expect(formatFullAddress({
      city: 'Curitiba'
    })).toBe('Curitiba')

    // State only
    expect(formatFullAddress({
      state: 'SP'
    })).toBe('SP')

    // Empty address object
    expect(formatFullAddress({})).toBe('')
  })

  it('should format full address with only neighborhood', () => {
    expect(formatFullAddress({ neighborhood: 'Downtown' })).toBe('Downtown')
  })

  it('should resolve UF names', () => {
    expect(getUFName('ac')).toBe('Acre')
    expect(getUFName('XX')).toBe('XX')
    expect(getUFName('')).toBe('')
  })
})
