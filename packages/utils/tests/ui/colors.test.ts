import { describe, it, expect } from 'vitest'
import { getContrastColor, ensureHexPrefix, colorTesting } from '@src/ui/colors.js'

describe('colors', () => {
  it('should calculate contrast color', () => {
    expect(getContrastColor('#000000')).toBe('white')
    expect(getContrastColor('#FFFFFF')).toBe('black')
    expect(getContrastColor('#000')).toBe('white')
    expect(getContrastColor('')).toBe('white')
    expect(getContrastColor('ffffff')).toBe('black')
  })

  it('should ensure hex prefix', () => {
    expect(ensureHexPrefix('ff00ff')).toBe('#ff00ff')
    expect(ensureHexPrefix('#ff00ff')).toBe('#ff00ff')
    expect(ensureHexPrefix('')).toBe('#000000')
  })

  it('should allow testing luminance inputs', () => {
    expect(colorTesting.getLuminance('#000000')).toBe(0)
    expect(colorTesting.getLuminance('ffffff')).toBeGreaterThan(0)
  })
})
