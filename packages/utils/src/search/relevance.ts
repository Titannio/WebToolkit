/**
 * @module search.relevance
 * @description Generic relevance ranking helpers for text-based search result ordering.
 */

import { normalizeSearchText } from './text.js'

/**
 * Input contract for relevance-based sorting.
 */
export type SortBySearchRelevanceOptions<T> = {
  items: T[]
  query: string
  getSearchTexts: (item: T) => Array<string | null | undefined>
  getTieBreakerText?: (item: T) => string | null | undefined
  locale?: string
}

/**
 * Computes a relevance rank score between normalized text and query.
 *
 * @param {string} text - Normalized candidate text.
 * @param {string} query - Normalized query.
 * @returns {number} Lower is better, Infinity when not relevant.
 */
function relevanceScore(text: string, query: string): number {
  const queryTokens = query.split(/\s+/).filter(Boolean)
  const textTokens = text.split(/\s+/).filter(Boolean)

  if (text === query) return 0
  if (text.startsWith(query)) return 1
  if (textTokens.some((chunk) => chunk.startsWith(query))) return 2
  if (text.includes(query)) return 3

  if (queryTokens.length > 1) {
    const hasAllTokenPrefixes = queryTokens.every((token) =>
      textTokens.some((chunk) => chunk.startsWith(token)),
    )
    if (!hasAllTokenPrefixes) return Number.POSITIVE_INFINITY

    let textCursor = 0
    let orderedMatches = 0
    for (const token of queryTokens) {
      while (textCursor < textTokens.length && !textTokens[textCursor]?.startsWith(token)) {
        textCursor += 1
      }

      if (textCursor < textTokens.length) {
        orderedMatches += 1
        textCursor += 1
      }
    }

    if (orderedMatches === queryTokens.length) return 4
    return 5
  }

  return Number.POSITIVE_INFINITY
}

/**
 * Sorts items by textual relevance using normalized search texts.
 *
 * @param {SortBySearchRelevanceOptions<T>} options - Sorting options.
 * @returns {T[]} Relevance-ranked items.
 */
export function sortBySearchRelevance<T>({
  items,
  query,
  getSearchTexts,
  getTieBreakerText,
  locale,
}: SortBySearchRelevanceOptions<T>): T[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return [...items]

  return items
    .map((item) => {
      const normalizedTexts = getSearchTexts(item)
        .map((text) => normalizeSearchText(text))
        .filter(Boolean)

      const bestScore = normalizedTexts.reduce<number>((acc, text) => {
        const score = relevanceScore(text, normalizedQuery)
        return score < acc ? score : acc
      }, Number.POSITIVE_INFINITY)

      const bestLengthDelta = normalizedTexts.reduce<number>((acc, text) => {
        const delta = Math.abs(text.length - normalizedQuery.length)
        return delta < acc ? delta : acc
      }, Number.POSITIVE_INFINITY)

      return { item, bestScore, bestLengthDelta }
    })
    .filter((row) => Number.isFinite(row.bestScore))
    .sort((a, b) => {
      if (a.bestScore !== b.bestScore) return a.bestScore - b.bestScore
      if (a.bestLengthDelta !== b.bestLengthDelta) return a.bestLengthDelta - b.bestLengthDelta

      const aLabel = getTieBreakerText?.(a.item) ?? ''
      const bLabel = getTieBreakerText?.(b.item) ?? ''
      return locale
        ? aLabel.localeCompare(bLabel, locale)
        : aLabel.localeCompare(bLabel)
    })
    .map((row) => row.item)
}
