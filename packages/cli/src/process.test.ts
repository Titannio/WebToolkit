import { describe, expect, it, vi } from 'vitest'

import { resolveSpawnSpec } from './process.js'

describe('process command resolution', () => {
  it('wraps package-manager commands through cmd.exe on Windows', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    try {
      expect(resolveSpawnSpec('pnpm', ['exec', 'depcruise'])).toEqual({
        command: process.env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', 'pnpm', 'exec', 'depcruise'],
      })
      expect(resolveSpawnSpec('pnpm.cmd', ['exec', 'depcruise'])).toEqual({
        command: process.env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', 'pnpm', 'exec', 'depcruise'],
      })
    } finally {
      platform.mockRestore()
    }
  })

  it('keeps non-package commands direct on Windows', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    try {
      expect(resolveSpawnSpec(process.execPath, ['script.js'])).toEqual({
        command: process.execPath,
        args: ['script.js'],
      })
    } finally {
      platform.mockRestore()
    }
  })

  it('keeps commands direct outside Windows', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')

    try {
      expect(resolveSpawnSpec('pnpm', ['exec', 'depcruise'])).toEqual({
        command: 'pnpm',
        args: ['exec', 'depcruise'],
      })
    } finally {
      platform.mockRestore()
    }
  })
})
