import {
  IMAGE_MIME_TYPES,
  type PopularImageMimeType,
} from '../../files/mime.js'
import {
  isValidDocumentSignature,
  isValidImageSignature,
} from '../../files/magic-bytes.js'

export { type PopularImageMimeType }

/** Receives aggregate upload progress as an integer percentage. */
export type UploadProgressCallback = (percentage: number) => void

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

/**
 * Downloads a Blob using the browser's native object URL support.
 *
 * @param {Blob} blob - File contents.
 * @param {string} filename - Suggested download name.
 * @returns {void}
 */
export function downloadBlobFile(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  try {
    anchor.href = objectUrl
    anchor.download = filename
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Aggregates per-file upload percentages proportionally to file size.
 *
 * @param files - Files whose progress will be reported.
 * @param onProgress - Aggregate progress callback.
 * @returns A callback for reporting progress for one file index.
 */
export function createUploadProgressAggregator(
  files: ReadonlyArray<Pick<File, 'size'>>,
  onProgress: UploadProgressCallback,
): (index: number, percentage: number) => void {
  const weights = files.map((file) => file.size || 1)
  const totalWeight = weights.reduce((total, size) => total + size, 0)
  const percentages = files.map(() => 0)

  return (index, percentage) => {
    if (index < 0 || index >= percentages.length || totalWeight === 0) return
    percentages[index] = Math.min(100, Math.max(0, percentage))
    const loaded = percentages.reduce(
      (total, current, currentIndex) => total + ((current / 100) * (weights[currentIndex] ?? 0)),
      0,
    )
    onProgress(Math.floor((loaded / totalWeight) * 100))
  }
}

/**
 * Uploads files in order while reporting aggregate progress.
 *
 * @param files - Files to upload.
 * @param uploadFile - Per-file upload operation.
 * @param onProgress - Aggregate progress callback.
 * @returns Results in the same order as the input files.
 */
export async function uploadFilesSequentially<TResult>(
  files: readonly File[],
  uploadFile: (file: File, index: number, onProgress: UploadProgressCallback) => Promise<TResult>,
  onProgress: UploadProgressCallback = () => undefined,
): Promise<TResult[]> {
  const results: TResult[] = []
  const reportProgress = createUploadProgressAggregator(files, onProgress)

  for (const [index, file] of files.entries()) {
    results.push(await uploadFile(file, index, (percentage) => reportProgress(index, percentage)))
    reportProgress(index, 100)
  }

  return results
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
