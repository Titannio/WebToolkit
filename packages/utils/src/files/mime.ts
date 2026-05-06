/**
 * @module MimeUtils
 * @description Standardized MIME type constants and utility functions for file processing.
 */

/**
 * List of popular MIME types for image uploads.
 * Centralized for consistent validation.
 */
export const IMAGE_MIME_TYPES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
] as const

/**
 * Represents the set of image MIME types supported by the platform.
 */
export type PopularImageMimeType = (typeof IMAGE_MIME_TYPES)[number]
/**
 * List of accepted MIME types for documents (PDF, Word).
 */
export const DOCUMENT_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

/**
 * List of accepted MIME types for spreadsheets (CSV, Excel).
 */
export const SPREADSHEET_MIME_TYPES = [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const

/**
 * List of accepted MIME types for audio files.
 */
export const AUDIO_MIME_TYPES = [
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
] as const

/**
 * List of accepted MIME types for video files.
 */
export const VIDEO_MIME_TYPES = [
    'video/mp4',
    'video/mpeg',
    'video/webm',
] as const

/**
 * List of accepted MIME types for archive/compressed files.
 */
export const ARCHIVE_MIME_TYPES = [
    'application/zip',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
] as const
