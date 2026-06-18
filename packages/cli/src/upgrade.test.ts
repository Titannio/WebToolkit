import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig } from './config.js'
import type { CommandResult, CommandSpec } from './process.js'

const processMocks = vi.hoisted(() => ({
  runCommandBuffered: vi.fn(),
  runCommandInherited: vi.fn(),
}))

const environmentMocks = vi.hoisted(() => ({
  prepareCorepackPnpm: vi.fn(),
}))

vi.mock('./process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./process.js')>()
  return {
    ...actual,
    runCommandBuffered: processMocks.runCommandBuffered,
    runCommandInherited: processMocks.runCommandInherited,
  }
})

vi.mock('./environment.js', () => ({
  prepareCorepackPnpm: environmentMocks.prepareCorepackPnpm,
}))

import { formatYesNoPrompt, parseYesNo, runUpgradeEngine } from './upgrade.js'

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-cli-upgrade-'))
  tempRoots.push(root)
  return root
}

function bufferedResult(output: string, code = 0): CommandResult {
  return { code, output }
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  processMocks.runCommandBuffered.mockReset()
  processMocks.runCommandInherited.mockReset()
  environmentMocks.prepareCorepackPnpm.mockReset()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('upgrade prompts', () => {
  it('formats yes/no prompts with explicit defaults', () => {
    expect(formatYesNoPrompt('❄', 'Cooldown enabled?', true)).toBe('❄ Cooldown enabled? [Y/N] Y ')
    expect(formatYesNoPrompt('↗', 'Major upgrades?', false)).toBe('↗ Major upgrades? [Y/N] N ')
    expect(formatYesNoPrompt('🔄', 'Protected singleton upgrades?', false)).toBe('🔄 Protected singleton upgrades? [Y/N] N ')
  })

  it('parses English and Portuguese yes/no answers with a default', () => {
    expect(parseYesNo('', true)).toBe(true)
    expect(parseYesNo('', false)).toBe(false)
    expect(parseYesNo('y', false)).toBe(true)
    expect(parseYesNo('sim', false)).toBe(true)
    expect(parseYesNo('n', true)).toBe(false)
    expect(parseYesNo('não', true)).toBe(false)
    expect(parseYesNo('maybe', true)).toBeNull()
  })
})

describe('upgrade cooldown', () => {
  it('fails closed when cooldown metadata cannot be read', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), ['packages:', '  - "."', ''].join('\n'))
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: {
        'fresh-dep': '^1.0.0',
      },
    }))

    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []

      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({
          'fresh-dep': {
            current: '1.0.0',
            latest: '1.1.0',
            dependentPackages: [{ location: root }],
          },
        }), 1)
      }

      if (args.includes('ncu') && args.includes('--jsonUpgraded')) {
        return bufferedResult(JSON.stringify({ 'package.json': { 'fresh-dep': '^1.1.0' } }))
      }

      if (args.includes('view')) {
        return bufferedResult('registry unavailable', 1)
      }

      throw new Error(`Unexpected buffered command: ${spec.command} ${(spec.args ?? []).join(' ')}`)
    })

    await expect(runUpgradeEngine({
      cwd: root,
      config: mergeConfig({
        upgrade: {
          defaultCooldownDays: 7,
          protectedOverridesFile: 'pnpm-workspace.yaml',
        },
      }),
    }, ['--yes'])).rejects.toThrow('Cooldown pre-check failed before manifests were changed.')

    expect(processMocks.runCommandInherited).not.toHaveBeenCalled()
  })

  it('holds packages with unknown release age instead of applying them', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), ['packages:', '  - "."', ''].join('\n'))
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: {
        'missing-time': '^1.0.0',
        'stable-dep': '^1.0.0',
      },
    }))

    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []

      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({
          'missing-time': {
            current: '1.0.0',
            latest: '1.1.0',
            dependentPackages: [{ location: root }],
          },
          'stable-dep': {
            current: '1.0.0',
            latest: '1.2.0',
            dependentPackages: [{ location: root }],
          },
        }), 1)
      }

      if (args.includes('ncu') && args.includes('--jsonUpgraded')) {
        const rejects = args.includes('--reject') ? args[args.indexOf('--reject') + 1].split(',') : []
        const updates: Record<string, string> = {}
        if (!rejects.includes('missing-time')) updates['missing-time'] = '^1.1.0'
        if (!rejects.includes('stable-dep')) updates['stable-dep'] = '^1.2.0'
        return bufferedResult(JSON.stringify({ 'package.json': updates }))
      }

      if (args.includes('view')) {
        return bufferedResult(JSON.stringify({
          '1.2.0': '2026-05-01T12:00:00.000Z',
        }))
      }

      throw new Error(`Unexpected buffered command: ${spec.command} ${(spec.args ?? []).join(' ')}`)
    })
    processMocks.runCommandInherited.mockReturnValue(0)

    await runUpgradeEngine({
      cwd: root,
      config: mergeConfig({
        upgrade: {
          defaultCooldownDays: 7,
          protectedOverridesFile: 'pnpm-workspace.yaml',
        },
      }),
    }, ['--yes'])

    const inheritedArgs = processMocks.runCommandInherited.mock.calls.map((call) => (call[0] as CommandSpec).args ?? [])
    const ncuUpgradeCommands = inheritedArgs.filter((args: string[]) => args.includes('ncu') && args.includes('-u'))

    expect(ncuUpgradeCommands).toContainEqual(expect.arrayContaining(['--reject', 'missing-time']))
  })

  it('applies cooldown rejects to protected singleton upgrade candidates', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), [
      'packages:',
      '  - "."',
      'overrides:',
      '  fresh-singleton: ^1.0.0',
      '',
    ].join('\n'))
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: {
        'fresh-singleton': '^1.0.0',
        'stable-dep': '^1.0.0',
      },
    }))

    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []

      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({
          'fresh-singleton': {
            current: '1.0.0',
            latest: '1.1.0',
            dependentPackages: [{ location: root }],
          },
          'stable-dep': {
            current: '1.0.0',
            latest: '1.2.0',
            dependentPackages: [{ location: root }],
          },
        }), 1)
      }

      if (args.includes('ncu') && args.includes('--jsonUpgraded')) {
        const rejects = args.includes('--reject') ? args[args.indexOf('--reject') + 1].split(',') : []
        const updates: Record<string, string> = {}
        if (!rejects.includes('fresh-singleton')) updates['fresh-singleton'] = '^1.1.0'
        if (!rejects.includes('stable-dep')) updates['stable-dep'] = '^1.2.0'
        return bufferedResult(JSON.stringify({ 'package.json': updates }))
      }

      if (args.includes('view')) {
        return bufferedResult(JSON.stringify({
          '1.1.0': '2026-06-16T12:00:00.000Z',
          '1.2.0': '2026-05-01T12:00:00.000Z',
        }))
      }

      throw new Error(`Unexpected buffered command: ${spec.command} ${(spec.args ?? []).join(' ')}`)
    })
    processMocks.runCommandInherited.mockReturnValue(0)

    await runUpgradeEngine({
      cwd: root,
      config: mergeConfig({
        upgrade: {
          defaultCooldownDays: 7,
          protectedOverridesFile: 'pnpm-workspace.yaml',
        },
      }),
    }, ['--yes', '--isolated'])

    const inheritedArgs = processMocks.runCommandInherited.mock.calls.map((call) => (call[0] as CommandSpec).args ?? [])
    const ncuUpgradeCommands = inheritedArgs.filter((args: string[]) => args.includes('ncu') && args.includes('-u'))

    expect(ncuUpgradeCommands).toContainEqual(expect.arrayContaining(['--reject', 'fresh-singleton']))
    expect(ncuUpgradeCommands.some((args: string[]) => args.includes('--filter') && args.includes('fresh-singleton'))).toBe(false)
  })
})

describe('upgrade package manager install', () => {
  it('prepares a changed pnpm packageManager and installs through a fresh pnpm command', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const originalNpmExecPath = process.env.npm_execpath
    process.env.npm_execpath = 'C:/old-pnpm/pnpm.cjs'

    try {
      const root = await createTempRoot()
      await writeFile(path.join(root, 'pnpm-workspace.yaml'), ['packages:', '  - "."', ''].join('\n'))
      await writeFile(path.join(root, 'package.json'), JSON.stringify({
        packageManager: 'pnpm@11.7.0',
        dependencies: {
          'stable-dep': '^1.0.0',
        },
      }))

      processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
        const args = spec.args ?? []

        if (args.includes('outdated')) {
          return bufferedResult(JSON.stringify({
            'stable-dep': {
              current: '1.0.0',
              latest: '1.2.0',
              dependentPackages: [{ location: root }],
            },
          }), 1)
        }

        if (args.includes('ncu') && args.includes('--jsonUpgraded')) {
          return bufferedResult(JSON.stringify({
            'package.json': {
              pnpm: '11.8.0',
              'stable-dep': '^1.2.0',
            },
          }))
        }

        throw new Error(`Unexpected buffered command: ${spec.command} ${(spec.args ?? []).join(' ')}`)
      })

      processMocks.runCommandInherited.mockImplementation((spec: CommandSpec) => {
        const args = spec.args ?? []

        if (args.includes('ncu') && args.includes('-u')) {
          const manifestPath = path.join(root, 'package.json')
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
          manifest.packageManager = 'pnpm@11.8.0'
          manifest.dependencies = { 'stable-dep': '^1.2.0' }
          writeFileSync(manifestPath, JSON.stringify(manifest))
          return 0
        }

        if (args.length === 1 && args[0] === 'install') return 0

        throw new Error(`Unexpected inherited command: ${spec.command} ${args.join(' ')}`)
      })

      await runUpgradeEngine({
        cwd: root,
        config: mergeConfig({
          upgrade: {
            defaultCooldownDays: 7,
            protectedOverridesFile: 'pnpm-workspace.yaml',
          },
        }),
      }, ['--yes', '--no-cooldown'])

      expect(environmentMocks.prepareCorepackPnpm).toHaveBeenCalledWith(expect.objectContaining({ cwd: root }), root, '11.8.0')

      const installCall = processMocks.runCommandInherited.mock.calls
        .map((call) => call[0] as CommandSpec)
        .find((spec) => (spec.args ?? []).length === 1 && spec.args?.[0] === 'install')

      expect(installCall).toBeDefined()
      expect(installCall?.command).not.toBe(process.execPath)
      expect(installCall?.args).toEqual(['install'])
    } finally {
      if (typeof originalNpmExecPath === 'undefined') {
        delete process.env.npm_execpath
      } else {
        process.env.npm_execpath = originalNpmExecPath
      }
    }
  })
})
