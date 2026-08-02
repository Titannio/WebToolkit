import { describe, expect, it } from 'vitest'
import { buildUrl, ensureUrlProtocol, joinUrl } from '@src/network/url.js'

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

  it('joins base URLs and paths without duplicate slashes', () => {
    expect(joinUrl('https://app.example.test/', '/dashboard')).toBe('https://app.example.test/dashboard')
  })

  it('preserves path queries and appends non-null query values', () => {
    expect(buildUrl('https://app.example.test', '/invite?step=otp', {
      token: 'abc 123',
      enabled: true,
      empty: undefined,
      absent: null,
    })).toBe('https://app.example.test/invite?step=otp&token=abc+123&enabled=true')
  })

  it('returns undefined when a configured base URL is absent', () => {
    expect(joinUrl(undefined, '/dashboard')).toBeUndefined()
    expect(buildUrl(undefined, '/dashboard')).toBeUndefined()
  })
})
