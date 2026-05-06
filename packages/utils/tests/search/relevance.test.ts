import { describe, expect, it } from 'vitest'
import { normalizeSearchText, sortBySearchRelevance } from '@src/search/index.js'

describe('search/relevance', () => {
  it('reuses the shared text normalization', () => {
    expect(normalizeSearchText('  CafÉ ')).toBe('cafe')
  })

  it('prioritizes exact matches over prefix matches', () => {
    const items = ['Cafeteria', 'Café', 'Cafeine']
    const ordered = sortBySearchRelevance({
      items,
      query: 'Cafe',
      getSearchTexts: (item) => [item],
      getTieBreakerText: (item) => item,
    })

    expect(ordered[0]).toBe('Café')
  })

  it('returns input order when query is empty', () => {
    const items = ['B', 'A']
    const ordered = sortBySearchRelevance({
      items,
      query: '',
      getSearchTexts: (item) => [item],
    })

    expect(ordered).toEqual(['B', 'A'])
  })

  it('sorts by score, delta and tie-breaker', () => {
    const items = ['Beta Center', 'Alfa', 'Beta']
    const ordered = sortBySearchRelevance({
      items,
      query: 'beta',
      getSearchTexts: (item) => [item],
      getTieBreakerText: (item) => item,
      locale: 'en-US',
    })

    expect(ordered[0]).toBe('Beta')
  })

  it('ranks chunk-prefix and includes matches', () => {
    const items = ['Hospital Beta', 'Center Betas', 'Alfa']
    const ordered = sortBySearchRelevance({
      items,
      query: 'beta',
      getSearchTexts: (item) => [item],
    })

    expect(ordered).toContain('Hospital Beta')
    expect(ordered).toContain('Center Betas')
  })

  it('returns empty result when no item matches', () => {
    const ordered = sortBySearchRelevance({
      items: ['Alfa', 'Gama'],
      query: 'zzz',
      getSearchTexts: (item) => [item],
    })

    expect(ordered).toEqual([])
  })

  it('sorts equal-score matches even without a tie breaker callback', () => {
    const ordered = sortBySearchRelevance({
      items: ['beta um', 'beta dois'],
      query: 'beta',
      getSearchTexts: (item) => [item],
    })

    expect(ordered).toHaveLength(2)
  })

  it('ranks includes score when query is inside a token', () => {
    const ordered = sortBySearchRelevance({
      items: ['beta'],
      query: 'eta',
      getSearchTexts: (item) => [item],
    })

    expect(ordered).toEqual(['beta'])
  })

  it('falls back tie-breaker labels to empty string when callback returns undefined', () => {
    const ordered = sortBySearchRelevance({
      items: ['b', 'a'],
      query: 'a',
      getSearchTexts: (item) => [item === 'a' ? 'a' : 'xa'],
      getTieBreakerText: () => undefined,
    })

    expect(ordered[0]).toBe('a')
  })

  it('falls back tie-breaker labels to empty string when callback is omitted', () => {
    const ordered = sortBySearchRelevance({
      items: ['first', 'second'],
      query: 'x',
      getSearchTexts: () => ['x'],
    })

    expect(ordered).toEqual(['first', 'second'])
  })

  it('matches multi-token queries in different words', () => {
    const ordered = sortBySearchRelevance({
      items: ['John Mendes Travis', 'John Silva'],
      query: 'john trav',
      getSearchTexts: (item) => [item],
    })

    expect(ordered).toEqual(['John Mendes Travis'])
  })

  it('matches insurance by token prefixes with accent-insensitive query', () => {
    const ordered = sortBySearchRelevance({
      items: ['Health Bridge', 'Bridge Health', 'Unimed'],
      query: 'hea bri',
      getSearchTexts: (item) => [item],
    })

    expect(ordered).toEqual(['Health Bridge', 'Bridge Health'])
  })

  it('handles out-of-order multi-token matches with lower score fallback', () => {
    const ordered = sortBySearchRelevance({
      items: ['cd ab', 'ab cd'],
      query: 'ab cd',
      getSearchTexts: (item) => [item],
    })

    expect(ordered).toEqual(['ab cd', 'cd ab'])
  })

  it('uses tie-breaker when score and length delta are equal', () => {
    const ordered = sortBySearchRelevance({
      items: ['alpha-b', 'alpha-a'],
      query: 'alpha',
      getSearchTexts: () => ['alpha', 'something'],
      getTieBreakerText: (item) => item,
    })

    expect(ordered).toEqual(['alpha-a', 'alpha-b'])
  })

  it('uses locale-aware tie-breaker when locale is provided', () => {
    const ordered = sortBySearchRelevance({
      items: ['éclair-b', 'éclair-a'],
      query: 'eclair',
      getSearchTexts: () => ['eclair'],
      getTieBreakerText: (item) => item,
      locale: 'en-US',
    })

    expect(ordered).toEqual(['éclair-a', 'éclair-b'])
  })
})
