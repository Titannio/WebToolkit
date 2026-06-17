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

vi.mock('./process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./process.js')>()
  return {
    ...actual,
    runCommandBuffered: processMocks.runCommandBuffered,
    runCommandInherited: processMocks.runCommandInherited,
  }
})

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
