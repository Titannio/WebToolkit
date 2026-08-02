import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createUploadProgressAggregator,
  downloadBlobFile,
  isImageFile,
  uploadFilesSequentially,
  validateDocumentMagicBytes,
  validateImageMagicBytes,
} from '@src/browser/files/index.js'

describe('browser/files', () => {
  const originalFileReader = globalThis.FileReader
  let nextBytes: Uint8Array | null = null
  let nextError: Error | null = null

  class MockFileReader {
    result: unknown
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    error: Error | null = null

    readAsArrayBuffer() {
      if (nextError) {
        this.error = nextError
        this.onerror?.()
        return
      }

      if (nextBytes) {
        this.result = nextBytes.buffer
      } else {
        this.result = 'invalid'
      }

      this.onload?.()
    }
  }

  beforeEach(() => {
    nextBytes = null
    nextError = null
    globalThis.FileReader = MockFileReader as typeof FileReader
  })

  afterEach(() => {
    globalThis.FileReader = originalFileReader
  })

  it('validates image files from browser File objects', () => {
    const pngFile = new File([], 'test.png', { type: 'image/png' })
    const jpgFile = new File([], 'test.jpg', { type: 'IMAGE/JPEG' })
    const txtFile = new File([], 'test.txt', { type: 'text/plain' })

    expect(isImageFile(pngFile)).toBe(true)
    expect(isImageFile(jpgFile)).toBe(true)
    expect(isImageFile(txtFile)).toBe(false)
  })

  it('returns false for invalid image file inputs', () => {
    // @ts-expect-error runtime safety check
    expect(isImageFile(null)).toBe(false)
    // @ts-expect-error runtime safety check
    expect(isImageFile('image/png')).toBe(false)
  })

  it('validates browser file magic bytes', async () => {
    const file = { slice: vi.fn() } as unknown as File

    nextBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0])
    await expect(validateDocumentMagicBytes(file)).resolves.toBe(true)

    nextBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    await expect(validateImageMagicBytes(file)).resolves.toBe(true)
    await expect(validateDocumentMagicBytes(file)).resolves.toBe(true)

    nextBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    await expect(validateDocumentMagicBytes(file)).resolves.toBe(false)
    await expect(validateImageMagicBytes(file)).resolves.toBe(false)
  })

  it('rejects invalid file reader results', async () => {
    const file = { slice: vi.fn() } as unknown as File
    await expect(validateImageMagicBytes(file)).rejects.toThrow('Failed to read file header.')
  })

  it('rejects file reader errors', async () => {
    nextError = new Error('FileReader failure')
    const file = { slice: vi.fn() } as unknown as File
    await expect(validateImageMagicBytes(file)).rejects.toThrow('FileReader failure')
  })

  it('downloads blobs and releases the object URL', () => {
    const blob = new Blob(['report'])
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    downloadBlobFile(blob, 'report.txt')

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report')
    expect(document.querySelector('a[download="report.txt"]')).toBeNull()
  })

  it('aggregates progress by file size and ignores invalid reports', () => {
    const onProgress = vi.fn()
    const report = createUploadProgressAggregator([{ size: 100 }, { size: 300 }], onProgress)

    report(0, 100)
    report(1, 50)
    report(2, 50)
    report(-1, 50)

    expect(onProgress).toHaveBeenNthCalledWith(1, 25)
    expect(onProgress).toHaveBeenNthCalledWith(2, 62)
  })

  it('clamps upload progress, gives empty files weight, and ignores empty sets', () => {
    const onProgress = vi.fn()
    const report = createUploadProgressAggregator([{ size: 0 }], onProgress)

    report(0, 150)
    report(0, -1)
    createUploadProgressAggregator([], onProgress)(0, 50)

    expect(onProgress).toHaveBeenNthCalledWith(1, 100)
    expect(onProgress).toHaveBeenNthCalledWith(2, 0)
    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  it('uploads files sequentially and reports completion', async () => {
    const files = [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.png', { type: 'image/png' }),
    ]
    const onProgress = vi.fn()
    const uploadFile = vi.fn(async (file: File, index: number, reportProgress: (percentage: number) => void) => {
      reportProgress(50)
      return `${index}:${file.name}`
    })

    await expect(uploadFilesSequentially(files, uploadFile, onProgress)).resolves.toEqual(['0:first.png', '1:second.png'])
    expect(uploadFile).toHaveBeenNthCalledWith(2, files[1], 1, expect.any(Function))
    expect(onProgress).toHaveBeenLastCalledWith(100)
    await expect(uploadFilesSequentially([], async () => 'unused')).resolves.toEqual([])
  })
})
