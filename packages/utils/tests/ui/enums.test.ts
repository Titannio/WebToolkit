import { describe, it, expect } from 'vitest'
import { toOptions, getLabelFromValue } from '@src/ui/enums.js'

describe('enums', () => {
  it('should convert labels to options with cache', () => {
    const labels = { A: 'Alpha', B: 'Beta' }
    const options1 = toOptions(labels)
    const options2 = toOptions(labels)
    expect(options1).toEqual([
      { label: 'Alpha', value: 'A' },
      { label: 'Beta', value: 'B' },
    ])
    expect(options1).toBe(options2)
  })

  it('should resolve labels by value', () => {
    expect(getLabelFromValue('A', { A: 'Alpha' })).toBe('Alpha')
    expect(getLabelFromValue('X', { A: 'Alpha' })).toBe('X')
  })
})
