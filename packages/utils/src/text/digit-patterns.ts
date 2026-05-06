/**
 * Utility helpers for matching digit-only strings against simplified regex-like patterns.
 */

export interface DigitPatternToken {
  matches: (digit: string) => boolean
  specificity: number
}

/**
 * Ranking metadata produced when evaluating a digit sequence against a pattern.
 */
export interface DigitPatternScore {
  exact: boolean
  specificity: number
  gap: number
}

/**
 * Compares two pattern scores and returns whether candidate should win.
 *
 * @param {DigitPatternScore} candidate - Candidate score.
 * @param {DigitPatternScore} current - Current best score.
 * @returns {boolean} `true` when candidate is better.
 */
export function isBetterDigitPatternScore(
  candidate: DigitPatternScore,
  current: DigitPatternScore,
): boolean {
  if (candidate.exact !== current.exact) return candidate.exact
  if (candidate.specificity !== current.specificity) {
    return candidate.specificity > current.specificity
  }

  return candidate.gap < current.gap
}

/**
 * Scores a digit sequence against the suffix of a tokenized pattern.
 *
 * @param {string} digits - Digit sequence to evaluate.
 * @param {DigitPatternToken[]} tokens - Tokenized pattern.
 * @returns {DigitPatternScore | undefined} Match score, or `undefined` when not matched.
 */
export function scoreDigitPatternSuffix(
  digits: string,
  tokens: DigitPatternToken[],
): DigitPatternScore | undefined {
  if (!digits || digits.length > tokens.length) return undefined

  const offset = tokens.length - digits.length
  let specificity = 0

  for (let index = 0; index < digits.length; index += 1) {
    const token = tokens[offset + index]
    const digit = digits[index]

    if (!token || !token.matches(digit)) {
      return undefined
    }

    specificity += token.specificity
  }

  return {
    exact: offset === 0,
    specificity,
    gap: offset,
  }
}

/**
 * Converts a simplified regex-like numeric pattern into concrete token variants.
 *
 * Supported tokens:
 * - `\\d`
 * - character classes such as `[3-9]`
 * - literal digits
 * - quantifiers such as `{n}` and `{min,max}`
 *
 * @param {string} regexPattern - Pattern source.
 * @param {string} [leadingDigitsToTrim=''] - Prefix digits to trim from the pattern.
 * @returns {DigitPatternToken[][]} Expanded token variants.
 */
export function buildDigitPatternVariants(
  regexPattern: string,
  leadingDigitsToTrim: string = '',
): DigitPatternToken[][] {
  const normalizedPattern = regexPattern
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(new RegExp(`^\\\\\\+${leadingDigitsToTrim}`), '')

  const segments: Array<{ token: DigitPatternToken; min: number; max: number }> = []

  for (let index = 0; index < normalizedPattern.length;) {
    const { token, nextIndex } = parseDigitPatternToken(normalizedPattern, index)
    const { min, max, nextIndex: quantifierIndex } = parsePatternQuantifier(normalizedPattern, nextIndex)

    segments.push({ token, min, max })
    index = quantifierIndex
  }

  return expandDigitPatternSegments(segments)
}

function parseDigitPatternToken(
  pattern: string,
  startIndex: number,
): { token: DigitPatternToken; nextIndex: number } {
  const currentChar = pattern[startIndex]

  if (currentChar === '\\' && pattern[startIndex + 1] === 'd') {
    return {
      token: {
        matches: (digit: string) => /\d/.test(digit),
        specificity: 0,
      },
      nextIndex: startIndex + 2,
    }
  }

  if (currentChar === '[') {
    const endIndex = pattern.indexOf(']', startIndex)
    const charClass = pattern.slice(startIndex, endIndex + 1)
    const matcher = new RegExp(`^${charClass}$`)

    return {
      token: {
        matches: (digit: string) => matcher.test(digit),
        specificity: 1,
      },
      nextIndex: endIndex + 1,
    }
  }

  if (/\d/.test(currentChar)) {
    return {
      token: {
        matches: (digit: string) => digit === currentChar,
        specificity: 2,
      },
      nextIndex: startIndex + 1,
    }
  }

  throw new Error(`Unsupported digit pattern token near "${pattern.slice(startIndex)}".`)
}

function parsePatternQuantifier(
  pattern: string,
  startIndex: number,
): { min: number; max: number; nextIndex: number } {
  if (pattern[startIndex] !== '{') {
    return { min: 1, max: 1, nextIndex: startIndex }
  }

  const endIndex = pattern.indexOf('}', startIndex)
  const quantifier = pattern.slice(startIndex + 1, endIndex)
  const [minText, maxText] = quantifier.split(',')
  const min = parseInt(minText, 10)
  const max = maxText ? parseInt(maxText, 10) : min

  return {
    min,
    max,
    nextIndex: endIndex + 1,
  }
}

function expandDigitPatternSegments(
  segments: Array<{ token: DigitPatternToken; min: number; max: number }>,
  segmentIndex: number = 0,
): DigitPatternToken[][] {
  if (segmentIndex >= segments.length) return [[]]

  const segment = segments[segmentIndex]
  const suffixes = expandDigitPatternSegments(segments, segmentIndex + 1)
  const variants: DigitPatternToken[][] = []

  for (let count = segment.min; count <= segment.max; count += 1) {
    const repeatedTokens = Array.from({ length: count }, () => segment.token)

    for (const suffix of suffixes) {
      variants.push([...repeatedTokens, ...suffix])
    }
  }

  return variants
}
