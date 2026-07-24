/**
 * @module image-processing
 * @description Universal image processor for the browser.
 * Handles resizing, optional square cropping, and WebP conversion using HTML5 Canvas.
 */

/**
 * Configuration options for image processing.
 */
export interface ProcessImageOptions {
    /** @type {number} - Maximum width in pixels. Default: 1920 */
    maxWidth?: number
    /** @type {number} - Maximum height in pixels. Default: 1920 */
    maxHeight?: number
    /** @type {number} - Quality of the WebP output (0 to 1). Default: 0.92 */
    quality?: number
    /** @type {boolean} - If true, crops the image to a centered square based on the smallest dimension. Default: false */
    cropToSquare?: boolean
}

/**
 * Handles resizing, optional square cropping, and WebP conversion.
 * 
 * Features:
 * - Aspect Ratio Maintenance: Preserves dimensions unless square cropping is enabled.
 * - Format Optimization: Converts images to WebP for better performance.
 * - Browser-Based: Uses HTML5 Canvas for client-side processing.
 * 
 * @param {File} file - The source image File.
 * @param {ProcessImageOptions} [options={}] - Processing options.
 * @returns {Promise<File>} - A promise resolving to the optimized WebP File.
 */
export async function processImage(file: File, options: ProcessImageOptions = {}): Promise<File> {
    const {
        maxWidth = 1920,
        maxHeight = 1920,
        quality = 0.92,
        cropToSquare = false
    } = options

    // Skip if not an image
    if (!file.type.startsWith('image/')) return file

    const dataUrl = await readFileAsDataURL(file)
    const img = await loadImage(dataUrl)

    let width = img.width
    let height = img.height
    let sx = 0
    let sy = 0
    let sWidth = width
    let sHeight = height

    if (cropToSquare) {
        // Square crop logic
        const size = Math.min(width, height)
        sx = Math.max(0, Math.floor((width - size) / 2))
        sy = Math.max(0, Math.floor((height - size) / 2))
        sWidth = size
        sHeight = size
        width = size
        height = size
    } else {
        // Resize logic - Maintain aspect ratio
        if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height)
            width = Math.floor(width * ratio)
            height = Math.floor(height * ratio)
        }
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!

    // Draw the image (source rect -> dest rect)
    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, width, height)

    // Convert to WebP
    const blob: Blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('WebP conversion failed')), 'image/webp', quality)
    }).catch(() => {
        // Fallback to JPEG
        return new Promise<Blob>(resolve => {
            canvas.toBlob(b => resolve((b as Blob)), 'image/jpeg', quality)
        })
    })

    // Construct filename with .webp extension
    const originalName = file.name.replace(/\.[^/.]+$/, "")
    const outName = `${originalName}.webp`

    return new File([blob], outName, { type: 'image/webp' })
}

/**
 * Reads a File object and converts it into a Base64 Data URL.
 * 
 * @param {File} file - The file to read.
 * @returns {Promise<string>} - A promise that resolves to the Data URL string.
 */
export function readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

/**
 * Programmatically loads an image from a source URL into an HTMLImageElement.
 * 
 * @param {string} src - The source URL or Data URL of the image.
 * @returns {Promise<HTMLImageElement>} - A promise that resolves to the loaded HTMLImageElement.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
    })
}
