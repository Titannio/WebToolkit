import {
  IMAGE_MIME_TYPES,
  type PopularImageMimeType,
} from '../../files/mime.js'
import {
  isValidDocumentSignature,
  isValidImageSignature,
} from '../../files/magic-bytes.js'

export { type PopularImageMimeType }

/**
 * Checks if a browser File looks like an image based on MIME type.
 *
 * @param {File} input - File candidate.
 * @returns {boolean} True when the file MIME type matches a known image type.
 */
export function isImageFile(input: File): boolean {
  if (!input || typeof input !== 'object' || !('type' in input)) return false

  const normalizedMimeType = input.type.toLowerCase()
  return (IMAGE_MIME_TYPES as readonly string[]).includes(normalizedMimeType)
}

/**
 * Validates a browser File against image signatures.
 *
 * @param {File} file - File candidate.
 * @returns {Promise<boolean>} True when the file header matches a known image signature.
 */
export async function validateImageMagicBytes(file: File): Promise<boolean> {
  const headerBytes = await readFileHead(file, 12)
  return isValidImageSignature(headerBytes)
}

/**
 * Validates a browser File against supported document signatures.
 *
 * @param {File} file - File candidate.
 * @returns {Promise<boolean>} True when the file header matches a known document or image signature.
 */
export async function validateDocumentMagicBytes(file: File): Promise<boolean> {
  const headerBytes = await readFileHead(file, 12)
  return isValidDocumentSignature(headerBytes)
}

async function readFileHead(file: File, bytesToRead: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result))
      } else {
        reject(new Error('Failed to read file header.'))
      }
    }

    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file.slice(0, bytesToRead))
  })
}
