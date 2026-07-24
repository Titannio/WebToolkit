/**
 * @module ImageProcessorNode
 * @description Provides image processing and validation services using Sharp for Node.js environments.
 */

import sharp from 'sharp'
import { type PopularImageMimeType } from '../../files/mime.js'
import { isValidImageSignature, isValidDocumentSignature } from '../../files/magic-bytes.js'
import { BadRequestError } from '../../core/errors.js'

export { type PopularImageMimeType }

/**
 * Validates the physical integrity of an image buffer using MagicBytes analysis.
 * Supports JPEG, PNG, GIF, and WebP.
 * @param {Buffer} buffer - The image buffer to validate.
 * @returns {boolean} - True if the buffer contains a valid image signature.
 */
export function isValidImageBuffer(buffer: Buffer): boolean {
    return isValidImageSignature(buffer);
}

/**
 * Validates if the buffer contains a valid document signature (MagicBytes).
 * Supports JPEG, PNG, GIF, WebP, and PDF.
 * @param {Buffer} buffer - The document buffer to validate.
 * @returns {boolean} - True if the buffer contains a valid document or image signature.
 */
export function isValidDocumentBuffer(buffer: Buffer): boolean {
    return isValidDocumentSignature(buffer);
}

/**
 * Processes an image buffer: resizes to max 1920px (maintaining aspect ratio)
 * and converts to WebP with high quality.
 * @param {Buffer} buffer - The image buffer to process.
 * @returns {Promise<Buffer>} - A promise resolving to the processed WebP buffer.
 */
export async function processImage(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
        .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer()
}

/**
 * Creates a square thumbnail (300x300) in WebP format.
 * @param {Buffer} buffer - The image buffer to create a thumbnail from.
 * @returns {Promise<Buffer>} - A promise resolving to the thumbnail WebP buffer.
 */
export async function createThumbnail(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
        .resize(300, 300, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer()
}

/**
 * Validates and processes a logo image:
 * - Checks for minimum dimensions (200x200).
 * - Validates aspect ratio (max 2:1 or 1:2).
 * - Resizes to max 512x512 while maintaining aspect ratio (fit: 'inside').
 * - Converts to WebP.
 * 
 * @param {Buffer} buffer - The image buffer.
 * @returns {Promise<Buffer>} The processed buffer.
 * @throws {BadRequestError} If dimensions are below minimum or aspect ratio is invalid.
 */
export async function processLogo(buffer: Buffer): Promise<Buffer> {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height || metadata.width < 200 || metadata.height < 200) {
        throw new BadRequestError('Logo dimensions must be at least 200x200px.');
    }

    const aspectRatio = metadata.width / metadata.height;
    if (aspectRatio > 2 || aspectRatio < 0.5) {
        throw new BadRequestError('Logo aspect ratio must stay within 2:1 and 1:2.');
    }

    return image
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer();
}
