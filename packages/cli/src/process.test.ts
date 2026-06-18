import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const spawned: {
     command: string
     args: string[]
     closeCode: number
     resolveOutput?: { stdout: string; stderr: string }
   }[] = []

type TestChildProcess = EventEmitter & {
  stdout?: NodePassThrough
  stderr?: NodePassThrough
}

vi.mock('node:child_process', () => {
  const actual = vi.importActual('node:child_process')
  const spawn = vi.fn()
  const spawnSync = vi.fn()

  return {
    ...(actual as object),
    spawn,
    spawnSync,
  }
})

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn, spawnSync } from 'node:child_process'
import { PassThrough as NodePassThrough } from 'node:stream'

import { buildFreshPackageManagerCommand, buildPackageManagerCommand, resolveCwd, resolveSpawnSpec, runCommandBuffered, runCommandInherited } from './process.js'

function resetChildMocks() {
  spawned.length = 0
  vi.mocked(spawn).mockReset()
  vi.mocked(spawnSync).mockReset()
}

function buildFakeChildProcess(code: number, stdout = '', stderr = '') {
  const proc = new EventEmitter() as TestChildProcess
  proc.stdout = new PassThrough() as NodePassThrough
  proc.stderr = new PassThrough() as NodePassThrough
  vi.mocked(spawn).mockImplementation((command: string, args: readonly string[]) => {
    const normalizedArgs = [...args]
    spawned.push({ command, args: normalizedArgs, closeCode: code, resolveOutput: { stdout, stderr } })
    if (stdout) proc.stdout!.write(stdout)
    if (stderr) proc.stderr!.write(stderr)
    proc.stdout!.end()
    proc.stderr!.end()
    setTimeout(() => proc.emit('close', code), 0)
    return proc as unknown as ReturnType<typeof spawn>
  })

  return proc
}

afterEach(() => {
  vi.restoreAllMocks()
  resetChildMocks()
})

describe('process helpers', () => {
  it('resolves cwd values', () => {
    expect(resolveCwd('/root', '../other')).toBe(path.join('/root', '../other'))
    expect(resolveCwd('/root', './child')).toBe(path.join('/root', './child'))
    expect(resolveCwd('/root')).toBe('/root')
  })

  it('builds package-manager commands using npm_execpath when available', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const npmExecPath = '/tmp/npm.cjs'

    const original = process.env.npm_execpath
    process.env.npm_execpath = npmExecPath
    try {
      expect(buildPackageManagerCommand('pnpm', ['--version', '--loglevel', 'info'])).toEqual({
        command: process.execPath,
        args: [npmExecPath, '--version', '--loglevel', 'info'],
      })
    } finally {
      process.env.npm_execpath = original
      platform.mockRestore()
    }
  })

  it('builds fresh package-manager commands without npm_execpath', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const npmExecPath = '/tmp/pnpm.cjs'
    const original = process.env.npm_execpath

    process.env.npm_execpath = npmExecPath
    try {
      expect(buildFreshPackageManagerCommand('pnpm', ['install'])).toEqual({
        command: 'pnpm.cmd',
        args: ['install'],
      })
    } finally {
      process.env.npm_execpath = original
      platform.mockRestore()
    }
  })

  it('builds package-manager commands for standard pnpm on non-windows', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const npmExecPath = process.env.npm_execpath

    try {
      delete process.env.npm_execpath
      expect(buildPackageManagerCommand('pnpm', ['--version']).command).toBe('pnpm')
      expect(buildPackageManagerCommand('pnpm', ['--version']).args).toEqual(['--version'])
    } finally {
      if (typeof npmExecPath === 'undefined') {
        delete process.env.npm_execpath
      } else {
        process.env.npm_execpath = npmExecPath
      }
      platform.mockRestore()
    }
  })

  it('wraps package-manager commands through cmd.exe on Windows', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    try {
      expect(resolveSpawnSpec('pnpm', ['run', 'test'])).toEqual({
        command: process.env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', 'pnpm', 'run', 'test'],
      })
      expect(resolveSpawnSpec('node', ['script.js'])).toEqual({
        command: 'node',
        args: ['script.js'],
      })
    } finally {
      platform.mockRestore()
    }
  })
})

describe('process execution helpers', () => {
  it('captures buffered output from spawned processes', async () => {
    buildFakeChildProcess(0, 'hello ', 'world')

    const result = await runCommandBuffered({ command: 'node', args: ['-v'] }, '/repo')

    expect(result).toEqual({ code: 0, output: 'hello world' })
    expect(spawned).toHaveLength(1)
    expect(vi.mocked(spawn)).toHaveBeenCalledWith('node', ['-v'], {
      cwd: '/repo',
      env: expect.objectContaining({ FORCE_COLOR: '1' }),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  })

  it('inherits commands with spawnSync output', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.mocked(spawnSync).mockReturnValue({ status: 2 } as never)

    const code = runCommandInherited({ command: 'pnpm', args: ['--version'] }, '/repo')

    expect(code).toBe(2)
    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('pnpm', ['--version'], {
      cwd: '/repo',
      env: expect.objectContaining({ FORCE_COLOR: '1' }),
      stdio: 'inherit',
    })
    platform.mockRestore()
  })

  it('throws when spawnSync returns an error object', () => {
    const error = new Error('boom')
    vi.mocked(spawnSync).mockReturnValue({ error } as never)

    expect(() => runCommandInherited({ command: 'bad', args: [] }, '/repo')).toThrow('boom')
  })
})
