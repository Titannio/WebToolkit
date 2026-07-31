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
        budgets: [{
          appDir: 'apps/webapp',
          label: 'large bundle',
          pattern: '^index\\.very-large\\.js$',
          maxRawBytes: 20,
        }],
      },
    }), ['--root', temp])

    expect(logs.some((line) => line.includes('Top 2 assets by raw size'))).toBe(true)
    expect(logs.some((line) => line.includes('!'))).toBe(true)
    expect(logs.some((line) => line.includes('PASS apps/webapp large bundle'))).toBe(true)

    await rm(temp, { recursive: true, force: true })
    spy.mockRestore()
  })

  it('reports passing, failing, required, and optional bundle budgets', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-audit-budgets-'))
    const dist = path.join(temp, 'apps', 'webapp', 'dist', 'assets')
    await mkdir(dist, { recursive: true })
    await writeFile(path.join(dist, 'large.js'), 'x'.repeat(20), 'utf8')
    await writeFile(path.join(dist, 'small.css'), 'x'.repeat(5), 'utf8')

    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig(temp, {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
        budgets: [
          { appDir: 'apps/webapp', label: 'large', pattern: '^large\\.js$', maxRawBytes: 20 },
          { appDir: 'apps/webapp', label: 'small', pattern: '^small\\.css$', maxRawBytes: 4 },
          { appDir: 'apps/webapp', label: 'required', pattern: '^required\\.js$', maxRawBytes: 10 },
          { appDir: 'apps/webapp', label: 'optional', pattern: '^optional\\.js$', maxRawBytes: 10, required: false },
        ],
      },
    }), [])

    expect(logs.some((line) => line.includes('Bundle budgets:'))).toBe(true)
    expect(logs.some((line) => line.includes('PASS apps/webapp large'))).toBe(true)
    expect(logs.some((line) => line.includes('FAIL apps/webapp small'))).toBe(true)
    expect(logs.some((line) => line.includes('MISSING apps/webapp required'))).toBe(true)
    expect(logs.some((line) => line.includes('SKIP apps/webapp optional'))).toBe(true)
    expect(process.exitCode).toBe(1)

    await rm(temp, { recursive: true, force: true })
  })

  it('enforces aggregate Brotli entrypoint budgets for local scripts and styles', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-entry-budgets-'))
    const dist = path.join(temp, 'apps', 'webapp', 'dist')
    await mkdir(path.join(dist, 'assets'), { recursive: true })
    await writeFile(path.join(dist, 'index.html'), [
      '<script type="module" src="/assets/index.js"></script>',
      '<script></script>',
      '<link href="/assets/index.js" rel="modulepreload">',
      '<link rel="stylesheet preload" href="./assets/styles.css?version=1">',
      '<link rel="icon" href="/favicon.svg">',
      '<link href="/without-rel.css">',
      '<link rel="stylesheet">',
      '<script src="https://cdn.example/vendor.js"></script>',
      '<link rel="stylesheet" href="data:text/css,body{}">',
      '<script src="/env-config.js#runtime"></script>',
    ].join('\n'), 'utf8')
    await writeFile(path.join(dist, 'assets', 'index.js'), 'const value = 1', 'utf8')
    await writeFile(path.join(dist, 'assets', 'styles.css'), 'body { color: black }', 'utf8')
    await writeFile(path.join(dist, 'env-config.js'), 'window.env = {}', 'utf8')

    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig(temp, {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
        entryBudgets: [
          { appDir: 'apps/webapp', label: 'passing entry', maxBrotliBytes: 1_000 },
          { appDir: 'apps/webapp', label: 'failing entry', maxBrotliBytes: 0 },
        ],
      },
    }), [])

    expect(logs.some((line) => line.includes('Entrypoint budgets:'))).toBe(true)
    expect(logs.some((line) => line.includes('PASS apps/webapp passing entry: 3 assets'))).toBe(true)
    expect(logs.some((line) => line.includes('FAIL apps/webapp failing entry: 3 assets'))).toBe(true)
    expect(logs.some((line) => line.includes('raw') && line.includes('gzip') && line.includes('brotli'))).toBe(true)
    expect(process.exitCode).toBe(1)

    await rm(temp, { recursive: true, force: true })
  })

  it('fails entrypoint budgets when index.html or a referenced local asset is missing', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-entry-missing-'))
    const dist = path.join(temp, 'apps', 'with-index', 'dist')
    await mkdir(path.join(dist, 'assets'), { recursive: true })
    await writeFile(path.join(dist, 'index.html'), '<script src="/assets/missing.js"></script>', 'utf8')

    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })

    runBundleAudit(runtimeWithConfig(temp, {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/with-index', 'apps/without-index'],
        entryBudgets: [
          { appDir: 'apps/with-index', label: 'missing asset', maxBrotliBytes: 1_000 },
          { appDir: 'apps/without-index', label: 'missing html', maxBrotliBytes: 1_000 },
        ],
      },
    }), [])

    expect(logs.some((line) => line.includes('MISSING apps/with-index missing asset'))).toBe(true)
    expect(logs.some((line) => line.includes('assets/missing.js'))).toBe(true)
    expect(logs.some((line) => line.includes('MISSING apps/without-index missing html'))).toBe(true)
    expect(process.exitCode).toBe(1)

    await rm(temp, { recursive: true, force: true })
  })

  it('rejects bundle budgets for apps outside the audit scope', () => {
    expect(() => runBundleAudit(runtimeWithConfig('/tmp', {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
        budgets: [{
          appDir: 'apps/other',
          label: 'other',
          pattern: '\\.js$',
          maxRawBytes: 10,
        }],
      },
    }), [])).toThrow('outside bundleAudit.appDirs')
  })

  it('rejects entrypoint budgets outside the audit scope and path traversal references', async () => {
    expect(() => runBundleAudit(runtimeWithConfig('/tmp', {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
        entryBudgets: [{
          appDir: 'apps/other',
          label: 'other',
          maxBrotliBytes: 10,
        }],
      },
    }), [])).toThrow('outside bundleAudit.appDirs')

    const temp = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-bundle-entry-traversal-'))
    const dist = path.join(temp, 'apps', 'webapp', 'dist')
    await mkdir(path.join(dist, 'assets'), { recursive: true })
    await writeFile(path.join(dist, 'index.html'), '<script src="../outside.js"></script>', 'utf8')
    await writeFile(path.join(temp, 'apps', 'webapp', 'outside.js'), 'unsafe', 'utf8')

    expect(() => runBundleAudit(runtimeWithConfig(temp, {
      packageManager: 'pnpm',
      bundleAudit: {
        appDirs: ['apps/webapp'],
        entryBudgets: [{
          appDir: 'apps/webapp',
          label: 'entry',
          maxBrotliBytes: 10,
        }],
      },
    }), [])).toThrow('resolves outside')

    await rm(temp, { recursive: true, force: true })
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
