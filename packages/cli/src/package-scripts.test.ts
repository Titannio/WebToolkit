import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

describe('package scripts', () => {
  it('keeps release scripts behind the local verification gate', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      scripts: Record<string, string>
    }

    expect(packageJson.scripts.verify).toBe('npm run type-check && npm run test:coverage && npm run build && npm run npm:pack')
    expect(packageJson.scripts['release:check']).toBe('npm run verify')
    expect(packageJson.scripts.prepublishOnly).toBe('npm run verify')
    expect(packageJson.scripts['deps:update']).toBe('npm update')
    expect(packageJson.scripts['npm:update']).toBeUndefined()
  })

  it('ships dependency-cruiser as a runtime dependency', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }

    expect(packageJson.dependencies?.['dependency-cruiser']).toBe('^18.0.0')
    expect(packageJson.peerDependencies?.['dependency-cruiser']).toBeUndefined()
  })
})
