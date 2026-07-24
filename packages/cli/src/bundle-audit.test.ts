import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runBundleAudit } from './bundle-audit.js'
import { mergeConfig } from './config.js'

const logs: string[] = []
const runtimeWithConfig = (cwd: string, config: Parameters<typeof mergeConfig>[0]) => ({ cwd, config: mergeConfig(config) })

describe('bundle audit', () => {
  afterEach(() => {
    logs.length = 0
    vi.restoreAllMocks()
    process.exitCode = 0
  })

  it('throws when no bundle app dirs are configured', () => {
    expect(() => runBundleAudit({
      cwd: '/',
      config: mergeConfig({ packageManager: 'pnpm', bundleAudit: { appDirs: [] } }),
    }, [])).toThrow('bundleAudit.appDirs is not configured.')
  })

  it('builds config from command-line flags and marks absence of assets as failure', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig('/fallback', {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/web'],
        top: 2,
        rawWarningBytes: 100,
      },
    }), ['--root', '/tmp/root', '--top', '1'])

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Frontend bundle audit'))
    expect(logs.some((line) => line.includes('No JS/CSS bundle assets found'))).toBe(true)
    expect(process.exitCode).toBe(1)
  })

  it('prints warning lines for oversized assets', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-audit-'))
    const dist = path.join(temp, 'apps', 'webapp', 'dist', 'assets')
    await mkdir(dist, { recursive: true })
    await writeFile(path.join(dist, 'index.very-large.js'), 'x'.repeat(20), 'utf8')
    await writeFile(path.join(dist, 'styles.css'), 'x'.repeat(5), 'utf8')

    const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig('/fallback', {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
        top: 5,
        rawWarningBytes: 10,
      },
    }), ['--root', temp])

    expect(logs.some((line) => line.includes('Top 2 assets by raw size'))).toBe(true)
    expect(logs.some((line) => line.includes('!'))).toBe(true)

    await rm(temp, { recursive: true, force: true })
    spy.mockRestore()
  })

  it('formats KiB and MiB sizes in the report', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-audit-sizes-'))
    const dist = path.join(temp, 'apps', 'webapp', 'dist', 'assets')
    await mkdir(dist, { recursive: true })
    await writeFile(path.join(dist, 'small.js'), 'x'.repeat(20), 'utf8')
    await writeFile(path.join(dist, 'medium.css'), 'x'.repeat(1536), 'utf8')
    await writeFile(path.join(dist, 'large.js'), 'x'.repeat(1024 * 1024 + 1024), 'utf8')

    const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig('/fallback', {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
        top: 5,
        rawWarningBytes: 1,
      },
    }), ['--root', temp])

    expect(logs.some((line) => line.includes('KiB'))).toBe(true)
    expect(logs.some((line) => line.includes('MiB'))).toBe(true)
    expect(logs.some((line) => line.includes('Warning threshold'))).toBe(true)

    await rm(temp, { recursive: true, force: true })
    spy.mockRestore()
  })

  it('parses positional args and sorts equal-size assets deterministically', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-audit-eq-'))
    const dist = path.join(temp, 'apps', 'webapp', 'dist', 'assets')
    await mkdir(dist, { recursive: true })
    const sameSize = 'x'.repeat(2048)
    await writeFile(path.join(dist, 'a.js'), sameSize, 'utf8')
    await writeFile(path.join(dist, 'b.css'), sameSize, 'utf8')

    const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig('/fallback', {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
        rawWarningBytes: 10_000_000,
      },
    }), ['--root', temp, 'standalone-arg'])

    expect(logs.some((line) => line.includes('Apps:'))).toBe(true)
    expect(logs.some((line) => line.includes('Warning threshold: 9.54 MiB raw.'))).toBe(true)
    expect(logs.some((line) => line.includes('a.js'))).toBe(true)

    await rm(temp, { recursive: true, force: true })
    spy.mockRestore()
  })

  it('parses mixed argument formats and skips positional arguments', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-audit-mixed-'))
    const dist = path.join(temp, 'apps', 'webapp', 'dist', 'assets')
    await mkdir(dist, { recursive: true })
    await writeFile(path.join(dist, 'app.js'), 'x'.repeat(10), 'utf8')

    const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig('/fallback', {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
        top: 5,
      },
    }), ['--top', '2', 'ignore-me', `--root=${temp}`, '--top=1'])

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Top 1 assets by raw size'))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Flagged assets: 0.'))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('stats.html missing'))
    await rm(temp, { recursive: true, force: true })
    spy.mockRestore()
  })

  it('respects stats.html presence and sorts equal-size files', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-audit-stats-'))
    const dist = path.join(temp, 'apps', 'webapp', 'dist')
    await mkdir(path.join(dist, 'assets'), { recursive: true })
    await writeFile(path.join(dist, 'stats.html'), '<html></html>', 'utf8')
    await writeFile(path.join(dist, 'assets', 'b.js'), 'x'.repeat(128), 'utf8')
    await writeFile(path.join(dist, 'assets', 'a.js'), 'x'.repeat(128), 'utf8')

    const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig('/fallback', {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
        top: 2,
      },
    }), ['--root', temp])

    expect(logs.some((line) => line.includes('stats.html ok'))).toBe(true)
    expect(logs.some((line) => line.includes('Top 2 assets by raw size'))).toBe(true)
    expect(logs.some((line) => line.includes('a.js'))).toBe(true)
    expect(logs.some((line) => line.includes('b.js'))).toBe(true)

    await rm(temp, { recursive: true, force: true })
    spy.mockRestore()
  })

  it('falls back to runtime cwd when option value is missing', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-audit-novalue-'))
    const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig(temp, {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
      },
    }), ['--root'])

    expect(logs.some((line) => line.includes('No JS/CSS bundle assets found'))).toBe(true)
    expect(process.exitCode).toBe(1)

    await rm(temp, { recursive: true, force: true })
    spy.mockRestore()
  })

  it('uses direct working-directory resolution for asset and stats paths', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-audit-rel-'))
    const dist = path.join(temp, 'apps', 'webapp', 'dist')
    await mkdir(path.join(dist, 'assets'), { recursive: true })
    await writeFile(path.join(dist, 'stats.html'), '<html></html>', 'utf8')
    await writeFile(path.join(dist, 'assets', 'bundle.js'), 'x'.repeat(16), 'utf8')

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(path.join(temp, 'apps', 'webapp', 'dist', 'assets'))
    const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig(temp, {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
      },
    }), ['--root', temp])

    expect(logs.some((line) => line.includes('App: apps/webapp') || line.includes('apps/webapp'))).toBe(true)
    await rm(temp, { recursive: true, force: true })
    spy.mockRestore()
    cwdSpy.mockRestore()
  })

  it('uses fallback stats path when cwd matches stats directory', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-audit-stats-fallback-'))
    const dist = path.join(temp, 'apps', 'webapp', 'dist')
    await mkdir(path.join(dist, 'assets'), { recursive: true })
    await writeFile(path.join(dist, 'stats.html'), '<html></html>', 'utf8')
    await writeFile(path.join(dist, 'assets', 'bundle.js'), 'x'.repeat(16), 'utf8')

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(path.join(temp, 'apps', 'webapp', 'dist'))
    const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig(temp, {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
      },
    }), ['--root', temp])

    expect(logs.some((line) => line.includes('stats.html ok'))).toBe(true)
    await rm(temp, { recursive: true, force: true })
    spy.mockRestore()
    cwdSpy.mockRestore()
  })

  it('falls back to the full stats path when relative resolution returns empty', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-audit-stats-fallback-empty-'))
    const dist = path.join(temp, 'apps', 'webapp', 'dist')
    await mkdir(path.join(dist, 'assets'), { recursive: true })
    await writeFile(path.join(dist, 'stats.html'), '<html></html>', 'utf8')
    await writeFile(path.join(dist, 'assets', 'bundle.js'), 'x'.repeat(16), 'utf8')

    const statsPath = path.join(dist, 'stats.html')
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(statsPath)
    const spy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig(temp, {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
      },
    }), ['--root', temp])

    expect(logs.some((line) => line.includes(`; ${statsPath}`))).toBe(true)

    await rm(temp, { recursive: true, force: true })
    spy.mockRestore()
    cwdSpy.mockRestore()
  })
}) 
