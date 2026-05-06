import { describe, expect, it } from 'vitest'
import {
  extractClientNetworkData,
  extractIpAddress,
  getSecurityCookieOptions,
} from '@src/server/http/request-metadata.js'

describe('server/http/request-metadata', () => {
  describe('extractIpAddress', () => {
    it('extracts IP from cf-connecting-ip header', () => {
      expect(extractIpAddress({ headers: { 'cf-connecting-ip': '1.2.3.4' } })).toBe('1.2.3.4')
      expect(extractIpAddress({ headers: { 'cf-connecting-ip': ['1.2.3.4', '5.6.7.8'] } })).toBe('1.2.3.4')
    })

    it('handles cf-connecting-ip arrays with undefined first value', () => {
      expect(extractIpAddress({ headers: { 'cf-connecting-ip': [undefined as unknown as string] } })).toBe('')
    })

    it('extracts IP from x-forwarded-for header', () => {
      expect(extractIpAddress({ headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' } })).toBe('10.0.0.1')
      expect(extractIpAddress({ headers: { 'x-forwarded-for': ['10.0.0.1, 192.168.1.1'] } })).toBe('10.0.0.1')
    })

    it('falls back when x-forwarded-for is empty', () => {
      expect(extractIpAddress({
        headers: { 'x-forwarded-for': '' },
        socket: { remoteAddress: '1.2.3.4' },
      })).toBe('1.2.3.4')
    })

    it('handles forwarded values with unexpected split behavior', () => {
      const weirdForwarded = {
        split: () => [] as string[],
      } as unknown as string

      expect(extractIpAddress({
        headers: { 'x-forwarded-for': weirdForwarded },
        socket: { remoteAddress: '9.9.9.9' },
      })).toBe('')
    })

    it('falls back when forwarded header array is empty', () => {
      expect(extractIpAddress({
        headers: { 'x-forwarded-for': [] },
        socket: { remoteAddress: '8.8.8.8' },
      })).toBe('8.8.8.8')
    })

    it('extracts IP from x-real-ip header and request socket', () => {
      expect(extractIpAddress({ headers: { 'x-real-ip': '10.0.0.2' } })).toBe('10.0.0.2')
      expect(extractIpAddress({ headers: { 'x-real-ip': [undefined as unknown as string] } })).toBe('')
      expect(extractIpAddress({ socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1')
      expect(extractIpAddress({ connection: { remoteAddress: '1.2.3.4' } })).toBe('1.2.3.4')
    })

    it('returns empty string when nothing is available', () => {
      expect(extractIpAddress({})).toBe('')
      expect(extractIpAddress(null)).toBe('')
    })
  })

  describe('extractClientNetworkData', () => {
    it('extracts normalized request metadata', () => {
      expect(extractClientNetworkData({
        headers: {
          'user-agent': 'Mozilla',
          referer: 'http://test.com',
        },
        socket: { remoteAddress: '1.1.1.1' },
      })).toEqual({
        ipAddress: '1.1.1.1',
        userAgent: 'Mozilla',
        referer: 'http://test.com',
      })
    })

    it('handles missing headers and referrer alias', () => {
      expect(extractClientNetworkData({ headers: {} })).toEqual({
        ipAddress: 'unknown',
        userAgent: 'unknown',
        referer: null,
      })

      expect(extractClientNetworkData({
        headers: { referrer: 'http://ref.com' },
      }).referer).toBe('http://ref.com')
    })
  })

  describe('getSecurityCookieOptions', () => {
    it('returns strict cookie defaults for production', () => {
      expect(getSecurityCookieOptions('production')).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
      })
    })

    it('returns lax cookie defaults for non-production', () => {
      expect(getSecurityCookieOptions('development')).toEqual({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      })
    })
  })
})
