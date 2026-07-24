import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runNoTestsInDist } from './assert-no-tests-in-dist.js'

const roots: string[] = []

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-dist-'))
  roots.push(directory)
  return directory
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('assert no tests in dist', () => {
  it('accepts clean output directories and the default dist path', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'dist', 'nested'), { recursive: true })
    await writeFile(path.join(directory, 'dist', 'nested', 'index.js'), 'export {}', 'utf8')
    expect(await runNoTestsInDist([], directory)).toBe(0)
  })

  it('reports test artifacts in nested output directories', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'build', '__tests__'), { recursive: true })
    await writeFile(path.join(directory, 'build', '__tests__', 'helper.js'), '', 'utf8')
    await writeFile(path.join(directory, 'build', 'component.test.js'), '', 'utf8')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await runNoTestsInDist(['build'], directory)).toBe(1)
    expect(error.mock.calls.flat().join('\n')).toContain('component.test.js')
  })

  it('fails clearly when an output directory cannot be read', async () => {
    const directory = await root()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await runNoTestsInDist(['missing'], directory)).toBe(1)
    expect(error.mock.calls.flat().join('\n')).toContain('Could not read missing')
  })
})
