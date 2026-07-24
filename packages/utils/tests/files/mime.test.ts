import { describe, it, expect } from 'vitest'
import {
  IMAGE_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  SPREADSHEET_MIME_TYPES,
  AUDIO_MIME_TYPES,
  VIDEO_MIME_TYPES,
  ARCHIVE_MIME_TYPES,
} from '@src/files/mime.js'

describe('mime types', () => {
  it('should include common entries', () => {
    expect(IMAGE_MIME_TYPES).toContain('image/png')
    expect(DOCUMENT_MIME_TYPES).toContain('application/pdf')
    expect(SPREADSHEET_MIME_TYPES).toContain('text/csv')
    expect(AUDIO_MIME_TYPES).toContain('audio/mpeg')
    expect(VIDEO_MIME_TYPES).toContain('video/mp4')
    expect(ARCHIVE_MIME_TYPES).toContain('application/zip')
  })
})
