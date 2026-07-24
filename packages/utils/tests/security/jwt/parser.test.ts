import { describe, it, expect, vi } from 'vitest'
import { parseJwt } from '@src/security/jwt/parser.js'

describe('auth utils', () => {
    describe('parseJwt', () => {
        it('should correctly parse a valid JWT payload', () => {
            const payload = { id: '123', email: 'test@example.com' }
            const encodedPayload = btoa(JSON.stringify(payload))
            const token = `header.${encodedPayload}.signature`
            
            expect(parseJwt(token)).toEqual(payload)
        })

        it('should handle base64url characters (- and _)', () => {
            // "{"test":"value?"}" in base64url is eyJ0ZXN0IjoidmFsdWU_In0
            // "{"test":"value?"}" in base64 is eyJ0ZXN0IjoidmFsdWU/In0
            const payload = { test: 'value?' }
            const token = 'header.eyJ0ZXN0IjoidmFsdWU_In0.signature'
            
            expect(parseJwt(token)).toEqual(payload)
        })

        it('should return an empty object if token part is missing', () => {
            expect(parseJwt('invalid-token')).toEqual({})
        })

        it('should return an empty object and log error if payload is not valid JSON', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
            const invalidBase64 = 'header.not-json.signature'
            
            expect(parseJwt(invalidBase64)).toEqual({})
            expect(consoleSpy).toHaveBeenCalled()
            consoleSpy.mockRestore()
        })

        it('should return an empty object for empty string', () => {
            expect(parseJwt('')).toEqual({})
        })

        it('should correctly handle utf-8 characters in payload', () => {
            const payload = { name: 'Renée Actions' }
            const jsonPayload = JSON.stringify(payload)
            const base64 = btoa(unescape(encodeURIComponent(jsonPayload)))
            const token = `header.${base64}.signature`
            
            expect(parseJwt(token)).toEqual(payload)
        })
    })
})









