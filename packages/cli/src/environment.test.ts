import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig } from './config.js'
import {
  assertExactPnpmVersion,
  prepareCorepackPnpm,
  readRequiredPnpmVersion,
  runEnvBootstrap,
  runEnvDoctor,
} from './environment.js'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(spawnSync).mockReset()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createRepo(packageManager = 'pnpm@11.17.0'): string {
  const root = mkdtempSync(join(tmpdir(), 'webtoolkit-environment-'))
  temporaryDirectories.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager }))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
  return root
}

function runtime(root: string, requiredNodeMajor?: number) {
  return {
    cwd: root,
    config: mergeConfig({
      environment: {
        corepackHome: '.corepack-test',
        ...(requiredNodeMajor === undefined ? {} : { requiredNodeMajor }),
      },
    }),
  }
}

describe('exact pnpm version validation', () => {
  it.each(['11.17.0', '12.0.0-rc.1'])('accepts %s', (version) => {
    expect(() => assertExactPnpmVersion(version)).not.toThrow()
  })

  it.each(['', '11', '11.17', 'latest', '^11.17.0', 'not-semver'])('rejects %s', (version) => {
    expect(() => assertExactPnpmVersion(version)).toThrow('packageManager must pin an exact pnpm version')
  })

  it('reads an exact pnpm version from package.json', () => {
    const root = createRepo()

    expect(readRequiredPnpmVersion(root)).toBe('11.17.0')
  })

  it('rejects a non-pnpm package manager', () => {
    const root = createRepo('npm@11.0.0')

    expect(() => readRequiredPnpmVersion(root)).toThrow('Expected packageManager to start with pnpm@')
  })

  it('rejects a missing package manager', () => {
    const root = createRepo()
    writeFileSync(join(root, 'package.json'), '{}')
    expect(() => readRequiredPnpmVersion(root)).toThrow('Expected packageManager to start with pnpm@')
  })
})

describe('environment commands', () => {
  it('prepares Corepack with inherited output and the configured home', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as never)
    const root = createRepo()

    prepareCorepackPnpm(runtime(root), root, '11.17.0')

    expect(spawnSync).toHaveBeenCalledTimes(2)
    expect(spawnSync).toHaveBeenLastCalledWith(expect.any(String), ['prepare', 'pnpm@11.17.0', '--activate'], expect.objectContaining({
      cwd: root,
      env: expect.objectContaining({ COREPACK_HOME: join(root, '.corepack-test') }),
      stdio: 'inherit',
    }))
  })

  it('uses the default Corepack home', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as never)
    const root = createRepo()

    prepareCorepackPnpm({ cwd: root, config: mergeConfig() }, root, '11.17.0')

    expect(spawnSync).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({
      env: expect.objectContaining({ COREPACK_HOME: join(root, '.corepack') }),
    }))
  })

  it('reports a failed Corepack command', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1 } as never)
    const root = createRepo()
    expect(() => prepareCorepackPnpm(runtime(root), root, '11.17.0')).toThrow('Command failed')
  })

  it('bootstraps missing Corepack and reports tool versions', () => {
    const root = createRepo()
    const existsSync = fs.existsSync
    vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => (
      String(filePath).endsWith('corepack') || String(filePath).endsWith('corepack.cmd')
        ? false
        : existsSync(filePath)
    ))
    vi.mocked(spawnSync).mockImplementation((command, args) => ({
      status: 0,
      stdout: (Array.isArray(args) ? args.includes('--version') : String(command).includes('--version')) ? '11.17.0\n' : '',
      stderr: '',
    }) as never)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    runEnvBootstrap(runtime(root))

    expect(info).toHaveBeenCalledWith(expect.stringContaining('Installing it via npm'))
    expect(spawnSync).toHaveBeenCalledWith(
      expect.stringMatching(/npm(?:\.cmd)?$/u),
      ['install', '--global', '--force', 'corepack'],
      expect.any(Object),
    )
    expect(info).toHaveBeenCalledWith('pnpm: 11.17.0')
  })

  it('uses an installed Corepack and enforces the configured Node major', () => {
    const root = createRepo()
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.mocked(spawnSync).mockImplementation((command, args) => ({
      status: 0,
      stdout: (Array.isArray(args) ? args.includes('--version') : String(command).includes('--version')) ? '11.17.0' : '',
      stderr: '',
    }) as never)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const major = Number(process.versions.node.split('.')[0])

    expect(() => runEnvBootstrap(runtime(root, major))).not.toThrow()
  })

  it('preserves Corepack integrity metadata during bootstrap', () => {
    const packageManager = 'pnpm@11.17.0+sha512.fixture'
    const root = createRepo(packageManager)
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.mocked(spawnSync).mockImplementation((_command, args) => ({
      status: 0,
      stdout: Array.isArray(args) && args.includes('--version') ? '11.17.0' : '',
      stderr: '',
    }) as never)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    runEnvBootstrap(runtime(root))

    expect(spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      ['prepare', packageManager, '--activate'],
      expect.any(Object),
    )
  })

  it('rejects the wrong Node major and a missing npm CLI', () => {
    const root = createRepo()
    const major = Number(process.versions.node.split('.')[0])
    expect(() => runEnvBootstrap(runtime(root, major + 1))).toThrow(`Expected Node ${major + 1}.x`)

    const existsSync = fs.existsSync
    vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => (
      /npm(?:\.cmd)?$/u.test(String(filePath)) ? false : existsSync(filePath)
    ))
    expect(() => runEnvBootstrap(runtime(root))).toThrow('npm was not found')
  })

  it('uses the Windows shell and quotes a Node installation path containing spaces', () => {
    const root = createRepo()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'execPath', 'get').mockReturnValue('C:/Program Files/nodejs/node.exe')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as never)

    prepareCorepackPnpm(runtime(root), root, '11.17.0')

    expect(spawnSync).toHaveBeenCalledWith(expect.stringContaining('"C:/Program Files/nodejs/corepack.cmd"'), expect.objectContaining({
      shell: true,
    }))
  })

  it('passes environment doctor for matching pins', () => {
    const root = createRepo()
    const major = Number(process.versions.node.split('.')[0])
    writeFileSync(join(root, '.nvmrc'), String(major))
    writeFileSync(join(root, '.node-version'), String(major))
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '11.17.0\n', stderr: '' } as never)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    runEnvDoctor(runtime(root, major))

    expect(info).toHaveBeenCalledWith('Environment doctor passed.')
  })

  it('passes environment doctor for matching pins with Corepack integrity metadata', () => {
    const root = createRepo('pnpm@11.17.0+sha512.fixture')
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '11.17.0\n', stderr: '' } as never)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    runEnvDoctor(runtime(root))

    expect(info).toHaveBeenCalledWith('Environment doctor passed.')
  })

  it('reports every environment mismatch', () => {
    const parent = mkdtempSync(join(tmpdir(), 'webtoolkit-environment-parent-'))
    temporaryDirectories.push(parent)
    const root = join(parent, 'repo')
    fs.mkdirSync(root)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.17.0' }))
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
    fs.mkdirSync(join(root, 'nested'))
    fs.mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git', 'ignored'), '')
    writeFileSync(join(root, 'nested', 'package-lock.json'), '')
    writeFileSync(join(root, 'nested', 'yarn.lock'), '')
    writeFileSync(join(root, 'nested', 'pnpm-lock.yaml'), '')
    fs.mkdirSync(join(parent, 'node_modules'))
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '11.16.0', stderr: '' } as never)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const major = Number(process.versions.node.split('.')[0]) + 1

    runEnvDoctor(runtime(root, major))

    const output = error.mock.calls.flat().join('\n')
    expect(output).toContain('Expected Node')
    expect(output).toContain('.nvmrc')
    expect(output).toContain('.node-version')
    expect(output).toContain('Expected pnpm')
    expect(output).toContain('package-lock.json')
    expect(output).toContain('yarn.lock')
    expect(output).toContain('pnpm-lock.yaml')
    expect(output).toContain('Parent node_modules')
  })

  it.each([
    [{ status: 1, stdout: '', stderr: 'stderr detail' }, 'stderr detail'],
    [{ status: 1, stdout: 'stdout detail', stderr: '' }, 'stdout detail'],
    [{ status: 1, stdout: '', stderr: '' }, 'Command failed'],
  ])('captures pnpm command failures: %j', (result, expected) => {
    const root = createRepo()
    vi.mocked(spawnSync).mockReturnValue(result as never)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    runEnvDoctor(runtime(root))

    expect(error.mock.calls.flat().join('\n')).toContain(expected)
  })

  it('finds the repository from a nested directory and rejects a directory outside one', () => {
    const root = createRepo()
    const nested = join(root, 'packages', 'app')
    fs.mkdirSync(nested, { recursive: true })
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '11.17.0', stderr: '' } as never)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(() => runEnvDoctor(runtime(nested))).not.toThrow()

    const outside = mkdtempSync(join(tmpdir(), 'webtoolkit-no-repo-'))
    temporaryDirectories.push(outside)
    expect(() => runEnvDoctor(runtime(outside))).toThrow('Could not find repo root')
  })
})
