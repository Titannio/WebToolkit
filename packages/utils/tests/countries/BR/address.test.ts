import { describe, it, expect } from 'vitest'
import { formatCityState, formatFullAddress, formatNeighborhoodCityState, getUFName } from '@src/countries/BR/address.js'

describe('brazilian address', () => {
  it('should format city/state and neighborhood', () => {
    expect(formatCityState('São Paulo', 'SP')).toBe('São Paulo/SP')
    expect(() => formatCityState('São Paulo', '')).toThrow('State is required')
    expect(() => formatCityState('', 'SP')).toThrow('City is required')
    expect(() => formatCityState('', '')).toThrow('City is required')
    expect(formatCityState('São Paulo', 'SP', '{city} - {state}')).toBe('São Paulo - SP')
    expect(formatNeighborhoodCityState('Centro', 'São Paulo', 'SP'))
      .toBe('Centro - São Paulo/SP')
    expect(() => formatNeighborhoodCityState('', 'São Paulo', 'SP')).toThrow('Neighborhood is required')
    expect(() => formatNeighborhoodCityState('Centro', '', 'SP')).toThrow('City is required')
    expect(() => formatNeighborhoodCityState('Centro', 'São Paulo', '')).toThrow('State is required')
    expect(formatNeighborhoodCityState('Centro', 'São Paulo', 'SP', '{city} - {neighborhood}')).toBe('São Paulo - Centro')
  })

  it('should format full address with S/N', () => {
    const formatted = formatFullAddress({
      street: 'Rua A',
      number: 0,
      complement: 'Apto 1',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
    })
    expect(formatted).toContain('Rua A, S/N')
    expect(formatted).toContain('Centro')
    expect(formatFullAddress(null)).toBe('')
    expect(formatFullAddress({ street: 'Rua B' })).toBe('Rua B')
    expect(formatFullAddress({ number: '0' })).toBe('S/N')
    expect(formatFullAddress({ number: 12 })).toBe('12')
    expect(formatFullAddress({ city: 'Campinas', state: 'SP' })).toBe('Campinas/SP')
    expect(formatFullAddress({ city: 'Campinas' })).toBe('Campinas')
    expect(formatFullAddress({ state: 'SP' })).toBe('SP')
  })

  it('should format full address with various combinations', () => {
    // Street + Number + Complement + Neighborhood + City + State
    expect(formatFullAddress({
      street: 'Rua A',
      number: '123',
      complement: 'Sala 1',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP'
    })).toBe('Rua A, 123 - Sala 1 - Centro - São Paulo/SP')

    // Street + Complement + City
    expect(formatFullAddress({
      street: 'Rua A',
      complement: 'Fundos',
      city: 'Curitiba'
    })).toBe('Rua A - Fundos - Curitiba')

    // Number + Neighborhood + State
    expect(formatFullAddress({
      number: '500',
      neighborhood: 'Jardins',
      state: 'RJ'
    })).toBe('500 - Jardins - RJ')

    // Street + Number (no street)
    expect(formatFullAddress({
      number: '100'
    })).toBe('100')

    // City only
    expect(formatFullAddress({
      city: 'São Paulo'
    })).toBe('São Paulo')

    // State only
    expect(formatFullAddress({
      state: 'SP'
    })).toBe('SP')

    // Empty address object
    expect(formatFullAddress({})).toBe('')
  })

  it('should format full address with only neighborhood', () => {
    expect(formatFullAddress({ neighborhood: 'Centro' })).toBe('Centro')
  })

  it('should resolve UF names', () => {
    expect(getUFName('sp')).toBe('São Paulo')
    expect(getUFName('XX')).toBe('XX')
    expect(getUFName('')).toBe('')
  })
})
