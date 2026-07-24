import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PathScanGuardConfig } from '../config.js'
import { runInternalLinkGuard } from './internal-link-guard.js'

const roots: string[] = []
const config: PathScanGuardConfig = { includePaths: ['apps/web/src'] }

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-link-'))
  roots.push(directory)
  return directory
}

async function source(content: string): Promise<string> {
  const directory = await root()
  await mkdir(path.join(directory, 'apps', 'web', 'src'), { recursive: true })
  await writeFile(path.join(directory, 'apps', 'web', 'src', 'Component.tsx'), content, 'utf8')
  return directory
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('internal link guard', () => {
  it('accepts router links and secure external anchors', async () => {
    const directory = await source(`
      export const Component = () => <>
        <Link to="/home">Home</Link>
        <a href="https://example.com" target="_blank" rel="noreferrer noopener">External</a>
        <a href={'https://example.com'} target={'_blank'} rel={\`noreferrer noopener\`}>External expression</a>
        <a href="mailto:test@example.com">Mail</a>
      </>
    `)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(await runInternalLinkGuard({ rootDir: directory, config })).toBe(0)
  })

  it('reports internal, placeholder, and insecure external anchors', async () => {
    const directory = await source(`
      export const Component = () => <>
        <a href="/home">Home</a>
        <a href="#">Placeholder literal</a>
        <a href={'#'}>Placeholder</a>
        <a href={'/expression'}>Expression route</a>
        <a href={"https://example.com"}>External</a>
        <a href={ROUTES.home}>Route</a>
        <a target="_blank">Blank</a>
      </>
    `)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(await runInternalLinkGuard({ rootDir: directory, config })).toBe(1)
    const output = info.mock.calls.flat().join('\n')
    expect(output).toContain('href="/home"')
    expect(output).toContain('placeholder')
    expect(output).toContain('noopener noreferrer')
    expect(output).toContain('Component.tsx')
  })

  it('honors exclusions and rejects missing or zero-match scopes', async () => {
    const excluded = await source('<a href="/ignored">Ignored</a>')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await expect(runInternalLinkGuard({
      rootDir: excluded,
      config: { ...config, excludePatterns: ['Component\\.tsx$'] },
    })).rejects.toThrow('zero eligible files')

    const missing = await root()
    await expect(runInternalLinkGuard({ rootDir: missing, config })).rejects.toThrow('missing directory')

    const empty = await root()
    await mkdir(path.join(empty, 'apps', 'web', 'src'), { recursive: true })
    await writeFile(path.join(empty, 'apps', 'web', 'src', 'ignored.ts'), 'export {}', 'utf8')
    await expect(runInternalLinkGuard({ rootDir: empty, config })).rejects.toThrow('zero eligible files')
  })

  it('accepts multiple include paths when one contains JSX', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'empty'), { recursive: true })
    await mkdir(path.join(directory, 'apps', 'web', 'src'), { recursive: true })
    await writeFile(path.join(directory, 'apps', 'web', 'src', 'Component.jsx'), '<a href="tel:123">Call</a>', 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(await runInternalLinkGuard({
      rootDir: directory,
      config: { includePaths: ['apps/empty', 'apps/web/src'] },
    })).toBe(0)
  })

  it('handles static, template, dynamic, and non-anchor JSX attributes', async () => {
    const directory = await source(`
      const destination = getDestination()
      export const Component = () => <>
        <div href="/not-an-anchor" />
        <a>Without href</a>
        <a href>Without initializer</a>
        <a href="">Empty</a>
        <a target>Target without initializer</a>
        <a target={}>Empty target expression</a>
        <a target={<span />}>Element target</a>
        <a target={destination}>Dynamic target</a>
        <a href="ftp://example.com">FTP</a>
        <a href={destination}>Dynamic</a>
        <a href={}>Empty href expression</a>
        <a href={<span />}>Element href</a>
        <a href={\`/users/\${id}\`}>Template route</a>
        <a href={'./relative'}>Relative</a>
        <a href={'mailto:test@example.com'}>Mail expression</a>
        <a href={'https://example.com'} target={'_blank'} rel={\`noopener noreferrer\`}>External</a>
      </>
    `)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(await runInternalLinkGuard({ rootDir: directory, config })).toBe(1)
  })

  it('defends direct callers from empty paths and malformed patterns', async () => {
    const directory = await root()
    await expect(runInternalLinkGuard({
      rootDir: directory,
      config: { includePaths: [] },
    })).rejects.toThrow('must not be empty')
    await expect(runInternalLinkGuard({
      rootDir: directory,
      config: { includePaths: ['src'], excludePatterns: ['['] },
    })).rejects.toThrow('Invalid regular expression')
  })

  it('recurses through nested configured directories', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'web', 'src', 'nested'), { recursive: true })
    await writeFile(
      path.join(directory, 'apps', 'web', 'src', 'nested', 'Component.tsx'),
      '<a href="mailto:test@example.com">Mail</a>',
      'utf8',
    )
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(await runInternalLinkGuard({ rootDir: directory, config })).toBe(0)
  })

  it('loads consumer policy when config is omitted and uses cwd when root is omitted', async () => {
    const directory = await source('<a href="mailto:test@example.com">Mail</a>')
    await mkdir(path.join(directory, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(directory, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: { internalLink: config },
    }), 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await expect(runInternalLinkGuard({ rootDir: directory })).resolves.toBe(0)
    await expect(runInternalLinkGuard({
      config: { includePaths: ['missing'] },
    })).rejects.toThrow('missing directory')
  })
})
