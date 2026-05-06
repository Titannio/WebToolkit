/**
 * @module magic-bytes.utils
 * @description Utilities for file signature validation (MagicBytes).
 * Allows for secure file type verification by inspecting the actual binary content rather than relying on extensions.
 */

/**
 * Known binary signatures for common image and document formats.
 */
const IMAGE_SIGNATURES = {
    // JPEG/JPG: FF D8 FF
    jpeg: [0xff, 0xd8, 0xff],
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    // GIF: 47 49 46 38
    gif: [0x47, 0x49, 0x46, 0x38],
    // WEBP: 52 49 46 46 (RIFF) ... 57 45 42 50 (WEBP)
    // To simplify, we only check the RIFF prefix and the initial WEBP suffix
    webp: [0x52, 0x49, 0x46, 0x46],
    // PDF: 25 50 44 46 2D (%PDF-)
    pdf: [0x25, 0x50, 0x44, 0x46, 0x2d]
}

/**
 * Validates if the binary data matches a known image signature.
 * Works with Uint8Array (compatible with Node.js Buffer).
 * 
 * @param {Uint8Array} data - The binary data to validate.
 * @returns {boolean} - True if the data has a valid image signature.
 */
export function isValidImageSignature(data: Uint8Array): boolean {
    if (!data || data.length < 12) return false;

    // PNG
    if (matchesSignature(data, IMAGE_SIGNATURES.png)) return true;

    // JPEG
    if (matchesSignature(data, IMAGE_SIGNATURES.jpeg)) return true;

    // GIF
    if (matchesSignature(data, IMAGE_SIGNATURES.gif)) return true;

    // WEBP
    const webpSignature = [0x57, 0x45, 0x42, 0x50];
    return (
        matchesSignature(data, IMAGE_SIGNATURES.webp) &&
        matchesSignature(data.slice(8, 12), webpSignature)
    );
}

/**
 * Validates if the binary data matches a known image or PDF signature.
 * Works with Uint8Array (compatible with Node.js Buffer).
 * 
 * @param {Uint8Array} data - The binary data to validate.
 * @returns {boolean} - True if the data has a valid image or PDF signature.
 */
export function isValidDocumentSignature(data: Uint8Array): boolean {
    if (!data || data.length < 12) return false;

    // PDF
    if (matchesSignature(data, IMAGE_SIGNATURES.pdf)) return true;

    return isValidImageSignature(data);
}

/**
 * Compares if the initial bytes match the provided signature.
 * 
 * @param {Uint8Array} data - The data to check.
 * @param {number[]} signature - The expected signature bytes.
 * @returns {boolean} - True if the data matches the signature.
 */
function matchesSignature(data: Uint8Array, signature: number[]): boolean {
    if (data.length < signature.length) return false;
    for (let i = 0; i < signature.length; i++) {
        if (data[i] !== signature[i]) return false;
    }
    return true;
}

/**
 * Exports the structure of testing.
 */
export const magicBytesTesting = { matchesSignature }

