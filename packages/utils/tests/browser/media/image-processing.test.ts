import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('image-processing (browser)', () => {
  const originalFileReader = globalThis.FileReader
  const originalImage = globalThis.Image
  const originalDocument = globalThis.document

  beforeEach(() => {
    class MockFileReader {
      result: string | ArrayBuffer | null = null
      onload: (() => void) | null = null
      onerror: ((err?: any) => void) | null = null
      readAsDataURL() {
        this.result = 'data:image/png;base64,AA=='
        this.onload?.()
      }
    }
    // @ts-expect-error mock
    globalThis.FileReader = MockFileReader

    class MockImage {
      width = 2000
      height = 1000
      onload: (() => void) | null = null
      onerror: ((err?: any) => void) | null = null
      set src(_value: string) {
        this.onload?.()
      }
    }
    // @ts-expect-error mock
    globalThis.Image = MockImage

    // Minimal document mock
    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: vi.fn(),
        }),
        toBlob: (cb: (b: Blob | null) => void, type?: string) => {
          if (type === 'image/webp') {
            cb(null)
          } else {
            cb(new Blob(['x'], { type: type || 'image/jpeg' }))
          }
        },
      } as any),
    } as any
  })

  afterEach(() => {
    globalThis.FileReader = originalFileReader
    globalThis.Image = originalImage
    globalThis.document = originalDocument
  })

  it('should process image and fallback to jpeg when webp fails', async () => {
    const module = await import('@src/browser/media/image-processing.js')
    const file = new File(['x'], 'photo.png', { type: 'image/png' })

    const out = await module.processImage(file, { cropToSquare: true })
    expect(out.name).toBe('photo.webp')
    expect(out.type).toBe('image/webp')
  })

  it('should process image when webp succeeds', async () => {
    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: vi.fn(),
        }),
        toBlob: (cb: (b: Blob | null) => void, type?: string) => {
          cb(new Blob(['x'], { type: type || 'image/webp' }))
        },
      } as any),
    } as any

    const module = await import('@src/browser/media/image-processing.js')
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    const out = await module.processImage(file)
    expect(out.type).toBe('image/webp')
  })

  it('should keep dimensions when within max size', async () => {
    class SmallImage {
      width = 100
      height = 100
      onload: (() => void) | null = null
      onerror: ((err?: any) => void) | null = null
      set src(_value: string) {
        this.onload?.()
      }
    }
    // @ts-expect-error mock
    globalThis.Image = SmallImage

    const module = await import('@src/browser/media/image-processing.js')
    const file = new File(['x'], 'small.png', { type: 'image/png' })
    const out = await module.processImage(file, { maxWidth: 200, maxHeight: 200 })
    expect(out.name).toBe('small.webp')
  })

  it('should return original file when not an image', async () => {
    const module = await import('@src/browser/media/image-processing.js')
    const file = new File(['x'], 'file.txt', { type: 'text/plain' })
    const out = await module.processImage(file)
    expect(out).toBe(file)
  })

  it('should read file as data URL', async () => {
    const module = await import('@src/browser/media/image-processing.js')
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    const dataUrl = await module.readFileAsDataURL(file)
    expect(dataUrl).toContain('data:image/png')
  })

  it('should load image', async () => {
    const module = await import('@src/browser/media/image-processing.js')
    const img = await module.loadImage('data:image/png;base64,AA==')
    expect(img.width).toBe(2000)
  })
})
