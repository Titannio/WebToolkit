import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { resolveDependencyCruiserBin, runDependencyCruiserGuard } from './dependency-cruiser-guard.js'

describe('dependency cruiser guard', () => {
  const cliRoot = path.join('repo', 'node_modules', '@titannio', 'webtoolkit-cli')
  const packageRoot = path.join(cliRoot, 'node_modules', 'dependency-cruiser')
  const binPath = path.join(packageRoot, 'bin', 'dependency-cruise.mjs')

  it('resolves the dependency-cruiser binary from the package installed with the CLI', () => {
    const actual = resolveDependencyCruiserBin({
      searchStart: path.join(cliRoot, 'dist', 'guards'),
      exists: (target) => target === path.join(packageRoot, 'package.json') || target === binPath,
      readFile: () => JSON.stringify({ name: 'dependency-cruiser' }),
    })

    expect(actual).toBe(binPath)
  })

  it('resolves a direct package root and rejects a missing binary', () => {
    const directRoot = path.join('repo', 'dependency-cruiser')
    const directBin = path.join(directRoot, 'bin', 'dependency-cruise.mjs')
    expect(resolveDependencyCruiserBin({
      searchStart: directRoot,
      exists: (target) => target === path.join(directRoot, 'package.json') || target === directBin,
      readFile: () => JSON.stringify({ name: 'dependency-cruiser' }),
    })).toBe(directBin)

    expect(() => resolveDependencyCruiserBin({
      searchStart: directRoot,
      exists: (target) => target === path.join(directRoot, 'package.json'),
      readFile: () => JSON.stringify({ name: 'dependency-cruiser' }),
    })).toThrow('binary not found')
  })

  it('ignores unrelated package manifests while walking through node_modules', () => {
    const nestedManifest = path.join(packageRoot, 'package.json')
    expect(() => resolveDependencyCruiserBin({
      searchStart: path.join(cliRoot, 'dist'),
      exists: (target) => target === nestedManifest,
      readFile: () => JSON.stringify({ name: 'another-package' }),
    })).toThrow('Could not find')

    const directRoot = path.join('repo', 'dependency-cruiser')
    expect(() => resolveDependencyCruiserBin({
      searchStart: directRoot,
      exists: (target) => target === path.join(directRoot, 'package.json'),
      readFile: () => JSON.stringify({ name: 'another-package' }),
    })).toThrow('Could not find')

    expect(() => resolveDependencyCruiserBin({
      searchStart: path.join('repo', 'node_modules'),
      exists: () => false,
      readFile: () => '',
    })).toThrow('Could not find')
  })

  it('passes args, cwd and color env to dependency-cruiser and returns its exit code', () => {
    const spawn = vi.fn().mockReturnValue({ status: 3, error: undefined })

    const code = runDependencyCruiserGuard(['apps', 'packages', '--config', '.webtoolkit-cli/dependency-cruiser.cjs'], {
      cwd: '/consumer',
      env: { PATH: '/bin' },
      execPath: '/node',
      searchStart: path.join(cliRoot, 'dist', 'guards'),
      exists: (target) => target === path.join(packageRoot, 'package.json') || target === binPath,
      readFile: () => JSON.stringify({ name: 'dependency-cruiser' }),
      spawn,
    })

    expect(code).toBe(3)
    expect(spawn).toHaveBeenCalledWith('/node', [
      binPath,
      'apps',
      'packages',
      '--config',
      '.webtoolkit-cli/dependency-cruiser.cjs',
    ], {
      cwd: '/consumer',
      env: { PATH: '/bin', FORCE_COLOR: '1' },
      stdio: 'inherit',
    })
  })

  it('returns a friendly error when dependency-cruiser cannot be resolved', () => {
    const messages: string[] = []
    const code = runDependencyCruiserGuard([], {
      searchStart: '/repo',
      exists: () => false,
      error: (message) => messages.push(String(message)),
    })

    expect(code).toBe(1)
    expect(messages.join('\n')).toContain('Dependency Cruiser guard is unavailable')
    expect(messages.join('\n')).toContain('@titannio/webtoolkit-cli')
  })

  it('propagates spawn failures and maps null status to failure', () => {
    const options = {
      searchStart: path.join(cliRoot, 'dist', 'guards'),
      exists: (target: string) => target === path.join(packageRoot, 'package.json') || target === binPath,
      readFile: () => JSON.stringify({ name: 'dependency-cruiser' }),
    }
    expect(() => runDependencyCruiserGuard([], {
      ...options,
      spawn: vi.fn().mockReturnValue({ status: null, error: new Error('spawn failed') }),
    })).toThrow('spawn failed')
    expect(runDependencyCruiserGuard([], {
      ...options,
      spawn: vi.fn().mockReturnValue({ status: null }),
    })).toBe(1)
  })

  it('uses the installed dependency and process defaults', () => {
    expect(resolveDependencyCruiserBin()).toMatch(/dependency-cruise\.mjs$/u)
    expect(runDependencyCruiserGuard(['--version'])).toBe(0)
  })
})
