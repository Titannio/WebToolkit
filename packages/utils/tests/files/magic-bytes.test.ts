import { describe, it, expect, vi } from 'vitest'
import {
  isValidImageSignature,
  isValidDocumentSignature,
  magicBytesTesting,
} from '@src/files/magic-bytes.js'

describe('magic bytes', () => {
  it('should validate image signatures from bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0])
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0, 0, 0, 0])
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 1, 1, 1, 0x57, 0x45, 0x42, 0x50])

    expect(isValidImageSignature(png)).toBe(true)
    expect(isValidImageSignature(jpeg)).toBe(true)
    expect(isValidImageSignature(gif)).toBe(true)
    expect(isValidImageSignature(webp)).toBe(true)
    expect(isValidDocumentSignature(pdf)).toBe(true)
    expect(isValidDocumentSignature(png)).toBe(true)
    expect(isValidDocumentSignature(new Uint8Array([1, 2, 3]))).toBe(false)
    expect(isValidImageSignature(new Uint8Array([1, 2, 3]))).toBe(false)
    expect(isValidImageSignature(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBe(false)
  })

  it('should validate WEBP signature path in image bytes', async () => {
    const { isValidImageSignature: isValidImageSignatureActual } =
      await vi.importActual<typeof import('@src/files/magic-bytes.js')>('@src/files/magic-bytes.js')
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

    expect(isValidImageSignatureActual(webp)).toBe(true)
  })

  it('should expose signature matcher for testing', () => {
    expect(magicBytesTesting.matchesSignature(new Uint8Array([1, 2]), [1, 2, 3])).toBe(false)
    expect(magicBytesTesting.matchesSignature(new Uint8Array([1, 2, 3]), [1, 2, 3])).toBe(true)
    expect(magicBytesTesting.matchesSignature(new Uint8Array([1, 2, 4]), [1, 2, 3])).toBe(false)
  })
})
