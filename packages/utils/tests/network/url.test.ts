import { describe, expect, it } from 'vitest'
import { ensureUrlProtocol } from '@src/network/url.js'

describe('url utils', () => {
  it('should keep explicit http and https protocols', () => {
    expect(ensureUrlProtocol('https://example.com')).toBe('https://example.com')
    expect(ensureUrlProtocol('http://example.com')).toBe('http://example.com')
  })

  it('should prepend https by default', () => {
    expect(ensureUrlProtocol('example.com')).toBe('https://example.com')
  })

  it('should support an http default protocol', () => {
    expect(ensureUrlProtocol('localhost:3000', { defaultProtocol: 'http' })).toBe('http://localhost:3000')
  })

  it('should keep empty values empty', () => {
    expect(ensureUrlProtocol('')).toBe('')
  })
})
