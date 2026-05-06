import { describe, it, expect } from 'vitest'
import { __authTypes } from '@src/security/jwt/types.js'
import { __serverHttpTypes } from '@src/server/http/types.js'
import { __commonTypes } from '@src/types/common.js'
import { __dateTypes } from '@src/dates/types.js'

describe('types runtime markers', () => {
  it('should expose runtime markers for type modules', () => {
    expect(__authTypes).toBe(true)
    expect(__serverHttpTypes).toBe(true)
    expect(__commonTypes).toBe(true)
    expect(__dateTypes).toBe(true)
  })
})
