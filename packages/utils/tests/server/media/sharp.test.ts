import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  isValidImageBuffer,
  isValidDocumentBuffer,
  processImage,
  createThumbnail,
  processLogo
} from '@src/server/media/sharp.js'
import { BadRequestError } from '@src/core/errors.js'

describe('server/media/sharp', () => {
  describe('isValidImageBuffer', () => {
    it('should return true for valid image signatures', () => {
      // PNG signature (8 bytes) + padding to reach 12 bytes minimum required by implementation
      const buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])
      expect(isValidImageBuffer(buffer)).toBe(true)
    })

    it('should return false for invalid signatures', () => {
      const buffer = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
      expect(isValidImageBuffer(buffer)).toBe(false)
    })
  })

  describe('isValidDocumentBuffer', () => {
    it('should return true for valid PDF signatures', () => {
      // PDF signature (5 bytes) + padding
      const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0])
      expect(isValidDocumentBuffer(buffer)).toBe(true)
    })

    it('should return true for valid image signatures (delegation)', () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])
      expect(isValidDocumentBuffer(buffer)).toBe(true)
    })
  })

  describe('processImage', () => {
    it('should process images and convert to webp', async () => {
      const input = await sharp({
        create: { width: 100, height: 100, channels: 3, background: 'red' }
      }).png().toBuffer()

      const result = await processImage(input)
      const metadata = await sharp(result).metadata()
      expect(metadata.format).toBe('webp')
    })
  })

  describe('createThumbnail', () => {
    it('should create 300x300 thumbnails', async () => {
      const input = await sharp({
        create: { width: 500, height: 500, channels: 3, background: 'blue' }
      }).png().toBuffer()

      const result = await createThumbnail(input)
      const metadata = await sharp(result).metadata()
      expect(metadata.width).toBe(300)
      expect(metadata.height).toBe(300)
      expect(metadata.format).toBe('webp')
    })
  })

  describe('processLogo', () => {
    it('should process valid logos', async () => {
      const input = await sharp({
        create: { width: 400, height: 400, channels: 3, background: 'green' }
      }).png().toBuffer()

      const result = await processLogo(input)
      const metadata = await sharp(result).metadata()
      expect(metadata.width).toBeLessThanOrEqual(512)
      expect(metadata.format).toBe('webp')
    })

    it('should reject small logos', async () => {
      const input = await sharp({
        create: { width: 100, height: 100, channels: 3, background: 'green' }
      }).png().toBuffer()

      await expect(processLogo(input)).rejects.toThrow(BadRequestError)
      await expect(processLogo(input)).rejects.toThrow('Logo dimensions must be at least 200x200px.')
    })

    it('should reject logos with invalid aspect ratio', async () => {
      const input = await sharp({
        // 600x200 is 3:1, triggers aspect ratio error (limit is 2:1)
        create: { width: 600, height: 200, channels: 3, background: 'green' }
      }).png().toBuffer()

      await expect(processLogo(input)).rejects.toThrow(BadRequestError)
      await expect(processLogo(input)).rejects.toThrow('Logo aspect ratio must stay within 2:1 and 1:2.')
    })
  })

})
