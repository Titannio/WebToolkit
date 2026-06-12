import { describe, expect, it, vi } from 'vitest'

async function importDevWatchForPlatform(platformName: NodeJS.Platform) {
  vi.resetModules()
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue(platformName)
  const module = await import('./dev-watch.js')
  return { module, platform }
}

describe('dev-watch process spawning', () => {
  it('keeps node executable commands direct on Windows', async () => {
    const { module, platform } = await importDevWatchForPlatform('win32')

    try {
      expect(module.resolveDevWatchSpawnSpec(process.execPath, ['C:\\repo\\node_modules\\pnpm\\bin\\pnpm.cjs', '--filter', 'app'])).toEqual({
        command: process.execPath,
        args: ['C:\\repo\\node_modules\\pnpm\\bin\\pnpm.cjs', '--filter', 'app'],
        detached: false,
      })
    } finally {
      platform.mockRestore()
    }
  })

  it('still wraps package-manager commands on Windows', async () => {
    const { module, platform } = await importDevWatchForPlatform('win32')

    try {
      expect(module.resolveDevWatchSpawnSpec('pnpm.cmd', ['--filter', 'app'])).toEqual({
        command: process.env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', 'pnpm', '--filter', 'app'],
        detached: false,
      })
    } finally {
      platform.mockRestore()
    }
  })
})
