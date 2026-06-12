import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isMainModule } from './rebuild-preflight.js'

describe('rebuild preflight entrypoint detection', () => {
  it('detects direct ESM execution without relying on CommonJS globals', () => {
    const entrypoint = path.resolve('dist/guards/rebuild-preflight.js')
    const moduleUrl = pathToFileURL(entrypoint).href

    expect(isMainModule(['node', entrypoint], moduleUrl)).toBe(true)
    expect(isMainModule(['node', path.resolve('dist/bin.js')], moduleUrl)).toBe(false)
  })
})
