import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { stdin as input, stdout as output } from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig } from './config.js'
import type { CommandResult, CommandSpec } from './process.js'

const processMocks = vi.hoisted(() => ({
  runCommandBuffered: vi.fn(),
  runCommandInherited: vi.fn(),
}))

const environmentMocks = vi.hoisted(() => ({
  assertExactPnpmVersion: vi.fn(),
  prepareCorepackPnpm: vi.fn(),
}))
const promptMocks = vi.hoisted(() => ({
  close: vi.fn(),
  question: vi.fn(),
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
  assertExactPnpmVersion: environmentMocks.assertExactPnpmVersion,
  prepareCorepackPnpm: environmentMocks.prepareCorepackPnpm,
}))

vi.mock('node:readline/promises', () => ({
  createInterface: () => promptMocks,
}))

import {
  applyManifestVersionStyle,
  addSkippedEntries,
  buildProtectedUpgradePlans,
  deriveProtectedOverrideTargetVersion,
  formatYesNoPrompt,
  getReleaseDate,
  getVersionMajor,
  normalizeNcuJson,
  normalizePnpmOutdatedJson,
  parseCliArgs,
  parseJsonObjectFromCommandOutput,
  parsePnpmPackageManagerVersion,
  parseYesNo,
  readManifestVersions,
  readProtectedOverrides,
  resolveOptions,
  runConfiguredStep,
  runUpgradeEngine,
  shouldIncludeOutdatedTarget,
  subtractWorkspaceUpdates,
  toWorkspaceManifestPath,
  unquoteYamlScalar,
  updateProtectedOverrides,
} from './upgrade.js'

const tempRoots: string[] = []
const originalInputIsTTY = Object.getOwnPropertyDescriptor(input, 'isTTY')
const originalOutputIsTTY = Object.getOwnPropertyDescriptor(output, 'isTTY')

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-cli-upgrade-'))
  tempRoots.push(root)
  return root
}

function bufferedResult(output: string, code = 0): CommandResult {
  return { code, output }
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/gu, '')
}

function countMatches(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  processMocks.runCommandBuffered.mockReset()
  processMocks.runCommandInherited.mockReset()
  environmentMocks.assertExactPnpmVersion.mockReset()
  environmentMocks.prepareCorepackPnpm.mockReset()
  promptMocks.close.mockClear()
  promptMocks.question.mockReset()
  if (originalInputIsTTY) Object.defineProperty(input, 'isTTY', originalInputIsTTY)
  else delete (input as { isTTY?: boolean }).isTTY
  if (originalOutputIsTTY) Object.defineProperty(output, 'isTTY', originalOutputIsTTY)
  else delete (output as { isTTY?: boolean }).isTTY
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('upgrade prompts', () => {
  it('formats yes/no prompts with explicit defaults', () => {
    expect(formatYesNoPrompt('❄', 'Cooldown enabled?', true)).toBe('❄ Cooldown enabled? [Y/n] ')
    expect(formatYesNoPrompt('↗', 'Major upgrades?', false)).toBe('↗ Major upgrades? [y/N] ')
    expect(formatYesNoPrompt('🔄', 'Protected singleton upgrades?', false)).toBe('🔄 Protected singleton upgrades? [y/N] ')
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

  it('resolves CLI flags and interactive answers', async () => {
    const runtime = { cwd: '/repo', config: mergeConfig({ upgrade: { defaultCooldownDays: 9 } }) }
    expect(parseCliArgs(runtime, ['--latest', '--verbose', '--align-protected-singletons', '--days=3'])).toEqual({
      allowMajor: true,
      verbose: true,
      alignProtectedSingletons: true,
      days: 3,
    })
    expect(parseCliArgs(runtime, ['--no-cooldown'])).toMatchObject({ days: 0 })
    expect(parseCliArgs(runtime, ['--days=invalid'])).toMatchObject({ days: 0 })

    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    promptMocks.question
      .mockResolvedValueOnce('invalid')
      .mockResolvedValueOnce('y')
      .mockResolvedValueOnce('n')
      .mockResolvedValueOnce('y')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await expect(resolveOptions(runtime, [])).resolves.toEqual({
      allowMajor: false,
      verbose: false,
      alignProtectedSingletons: true,
      days: 9,
    })
    expect(promptMocks.close).toHaveBeenCalled()

    promptMocks.question
      .mockResolvedValueOnce('y')
      .mockResolvedValueOnce('n')
      .mockResolvedValueOnce('n')
    await expect(resolveOptions({
      cwd: '/repo',
      config: { ...mergeConfig(), upgrade: undefined },
    }, ['--no-cooldown'])).resolves.toMatchObject({ days: 7 })

    promptMocks.question
      .mockResolvedValueOnce('n')
      .mockResolvedValueOnce('n')
      .mockResolvedValueOnce('n')
    await expect(resolveOptions(runtime, [])).resolves.toMatchObject({ days: 0 })
  })
})

describe('upgrade normalization helpers', () => {
  it('normalizes version and package-manager variants', () => {
    expect(parsePnpmPackageManagerVersion(undefined)).toBeNull()
    expect(parsePnpmPackageManagerVersion('npm@11.0.0')).toBeNull()
    expect(parsePnpmPackageManagerVersion('pnpm@11.8.0 ')).toBe('11.8.0')
    expect(environmentMocks.assertExactPnpmVersion).toHaveBeenCalledWith('11.8.0')
    expect(getVersionMajor('workspace:*')).toBeNull()
    expect(getVersionMajor('^12.3.0')).toBe(12)
    expect(shouldIncludeOutdatedTarget('', '1.0.0', 'minor')).toBe(false)
    expect(shouldIncludeOutdatedTarget('1.0.0', '', 'minor')).toBe(false)
    expect(shouldIncludeOutdatedTarget('1.0.0', '1.0.0', 'minor')).toBe(false)
    expect(shouldIncludeOutdatedTarget('1.0.0', '2.0.0', 'latest')).toBe(true)
    expect(shouldIncludeOutdatedTarget('workspace:*', '2.0.0', 'minor')).toBe(false)
    expect(applyManifestVersionStyle('~1.0.0', '^1.2.0')).toBe('~1.2.0')
    expect(applyManifestVersionStyle(undefined, '~1.2.0')).toBe('1.2.0')
    expect(unquoteYamlScalar("'value'")).toBe('value')
    expect(unquoteYamlScalar('"value"')).toBe('value')
    expect(unquoteYamlScalar(' value ')).toBe('value')
  })

  it('normalizes ncu output shapes and embedded JSON', () => {
    expect(normalizeNcuJson('')).toEqual({})
    expect(normalizeNcuJson('{"a":"2.0.0","ignored":1}')).toEqual({ 'package.json': { a: '2.0.0' } })
    expect(normalizeNcuJson('{"b/package.json":{"z":"2"},"a/package.json":{"a":"1","bad":false}}')).toEqual({
      'a/package.json': { a: '1' },
      'b/package.json': { z: '2' },
    })
    expect(parseJsonObjectFromCommandOutput('warn\n{"text":"a\\\\\\"{b}","nested":{"ok":true}}\nwarn'))
      .toEqual({ text: 'a\\"{b}', nested: { ok: true } })
    expect(() => parseJsonObjectFromCommandOutput('warning only')).toThrow('No JSON object')
    expect(() => parseJsonObjectFromCommandOutput('warning {"open": true')).toThrow('Unterminated JSON object')
  })

  it('normalizes pnpm outdated metadata and workspace locations', () => {
    const root = path.resolve('C:/repo')
    expect(toWorkspaceManifestPath(root, root)).toBe('package.json')
    expect(toWorkspaceManifestPath(path.join(root, 'packages', 'app'), root)).toBe('packages/app/package.json')
    expect(toWorkspaceManifestPath(path.dirname(root), root)).toBeNull()
    expect(normalizePnpmOutdatedJson('', root, 'minor')).toEqual({})

    const output = normalizePnpmOutdatedJson(JSON.stringify({
      action: { dependencyType: 'githubAction', current: '1', latest: '2' },
      missingCurrent: { latest: '1.0.0' },
      missingLatest: { current: '1.0.0' },
      major: { current: '1.0.0', latest: '2.0.0', dependentPackages: [{ location: root }] },
      noDependents: { current: '1.0.0', latest: '1.1.0', dependentPackages: 'invalid' },
      malformed: { current: '1.0.0', latest: '1.1.0', dependentPackages: [null, {}, { location: 1 }] },
      outside: { current: '1.0.0', latest: '1.1.0', dependentPackages: [{ location: path.dirname(root) }] },
      valid: {
        current: '1.0.0',
        latest: '1.1.0',
        dependentPackages: [{ location: root }, { location: path.join(root, 'packages', 'app') }],
      },
    }), root, 'minor')
    expect(output).toEqual({
      'package.json': { valid: '1.1.0' },
      'packages/app/package.json': { valid: '1.1.0' },
    })
  })

  it('reads supported manifest sections and combines skipped-update priorities', async () => {
    const root = await createTempRoot()
    const manifest = path.join(root, 'package.json')
    await writeFile(manifest, JSON.stringify({
      dependencies: { dep: '^1.0.0', ignored: 1 },
      devDependencies: { dev: '~1.0.0' },
      peerDependencies: null,
      optionalDependencies: [],
    }))
    await expect(readManifestVersions(manifest)).resolves.toEqual({ dep: '^1.0.0', dev: '~1.0.0' })
    expect(subtractWorkspaceUpdates(
      { 'a/package.json': { one: '2', two: '2' }, 'b/package.json': { three: '2' } },
      { 'a/package.json': { one: '2' } },
    )).toEqual({
      'a/package.json': { two: '2' },
      'b/package.json': { three: '2' },
    })
    const skipped = new Map()
    const base = {
      filePath: 'package.json',
      packageName: 'dep',
      currentVersion: '1',
      targetVersion: '2',
    }
    addSkippedEntries(skipped, [{ ...base, reason: 'protected-singleton' }])
    addSkippedEntries(skipped, [{ ...base, reason: 'major' }])
    addSkippedEntries(skipped, [{ ...base, reason: 'cooldown' }])
    addSkippedEntries(skipped, [{ ...base, reason: 'protected-singleton' }])
    expect(skipped.get('package.json::dep')).toMatchObject({ reason: 'cooldown' })
  })
})

describe('protected upgrade helpers', () => {
  it('reads, updates, and validates protected overrides', async () => {
    const root = await createTempRoot()
    expect(readProtectedOverrides(root, 'missing.yaml')).toEqual({})
    const workspaceFile = path.join(root, 'pnpm-workspace.yaml')
    await writeFile(workspaceFile, [
      'packages:',
      '  - "."',
      'overrides:',
      '  "quoted": "^1.0.0"',
      "  'single': '~1.0.0'",
      '  # comment',
      'next: true',
      '',
    ].join('\n'))
    expect(readProtectedOverrides(root, 'pnpm-workspace.yaml')).toEqual({
      quoted: '^1.0.0',
      single: '~1.0.0',
    })
    await updateProtectedOverrides(root, 'pnpm-workspace.yaml', {})
    await updateProtectedOverrides(root, 'pnpm-workspace.yaml', { quoted: '^2.0.0' })
    expect(readProtectedOverrides(root, 'pnpm-workspace.yaml').quoted).toBe('^2.0.0')
    await expect(updateProtectedOverrides(root, 'pnpm-workspace.yaml', { absent: '1.0.0' }))
      .rejects.toThrow('Unable to update')
  })

  it('builds styled plans and rejects ambiguous singleton targets', async () => {
    expect(deriveProtectedOverrideTargetVersion('^1.0.0', '2.0.0')).toBe('^2.0.0')
    expect(deriveProtectedOverrideTargetVersion('~1.0.0', '2.0.0')).toBe('~2.0.0')
    expect(deriveProtectedOverrideTargetVersion(null, '2.0.0')).toBe('2.0.0')
    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'overrides:\n  singleton: ^1.0.0\n  alpha: 1.0.0\n')
    const runtime = {
      cwd: root,
      config: mergeConfig({
        upgrade: {
          protectedDependencyUpstreamHints: { singleton: ['upstream'] },
        },
      }),
    }
    expect(buildProtectedUpgradePlans(runtime, [
      {
        filePath: 'package.json',
        packageName: 'singleton',
        currentVersion: '^1.0.0',
        targetVersion: '^2.0.0',
      },
      {
        filePath: 'package.json',
        packageName: 'alpha',
        currentVersion: '1.0.0',
        targetVersion: '2.0.0',
      },
      {
        filePath: 'package.json',
        packageName: 'beta',
        currentVersion: null,
        targetVersion: '2.0.0',
      },
    ])).toEqual([
      {
        packageName: 'alpha',
        currentOverride: '1.0.0',
        targetVersion: '2.0.0',
        upstreamHints: [],
      },
      {
        packageName: 'beta',
        currentOverride: null,
        targetVersion: '2.0.0',
        upstreamHints: [],
      },
      {
        packageName: 'singleton',
        currentOverride: '^1.0.0',
        targetVersion: '^2.0.0',
        upstreamHints: ['upstream'],
      },
    ])
    expect(() => buildProtectedUpgradePlans(runtime, [
      { filePath: 'a/package.json', packageName: 'singleton', currentVersion: '1', targetVersion: '2.0.0' },
      { filePath: 'b/package.json', packageName: 'singleton', currentVersion: '1', targetVersion: '3.0.0' },
    ])).toThrow('ambiguous')
  })

  it('parses release dates and rejects invalid registry output', async () => {
    const runtime = { cwd: '/repo', config: mergeConfig() }
    processMocks.runCommandBuffered
      .mockResolvedValueOnce(bufferedResult('{"1.0.0":"2026-01-01T00:00:00.000Z"}'))
      .mockResolvedValueOnce(bufferedResult('{"other":"2026-01-01T00:00:00.000Z"}'))
      .mockResolvedValueOnce(bufferedResult('{"1.0.0":""}'))
      .mockResolvedValueOnce(bufferedResult('{"1.0.0":"invalid"}'))
      .mockResolvedValueOnce(bufferedResult('', 1))
      .mockResolvedValueOnce(bufferedResult('not json'))
    await expect(getReleaseDate(runtime, 'pkg', '1.0.0')).resolves.toEqual(new Date('2026-01-01T00:00:00.000Z'))
    await expect(getReleaseDate(runtime, 'pkg', '1.0.0')).resolves.toBeNull()
    await expect(getReleaseDate(runtime, 'pkg', '1.0.0')).resolves.toBeNull()
    await expect(getReleaseDate(runtime, 'pkg', '1.0.0')).resolves.toBeNull()
    await expect(getReleaseDate(runtime, 'pkg', '1.0.0')).rejects.toThrow('Unable to read')
    await expect(getReleaseDate(runtime, 'pkg', '1.0.0')).rejects.toThrow('Invalid npm release metadata')

    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    processMocks.runCommandBuffered.mockResolvedValueOnce(bufferedResult('{"1.0.0":"2026-01-01T00:00:00.000Z"}'))
    await getReleaseDate(runtime, 'pkg', '1.0.0')
    expect(processMocks.runCommandBuffered).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: 'npm' }),
      '/repo',
    )
  })

  it('runs configured steps and preserves their exit code', () => {
    const runtime = { cwd: '/repo', config: mergeConfig() }
    expect(() => runConfiguredStep(runtime, { label: 'Broken' } as never)).toThrow('must define command')
    processMocks.runCommandInherited.mockReturnValueOnce(0)
    expect(() => runConfiguredStep(runtime, { label: 'Okay', command: 'node' })).not.toThrow()
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    processMocks.runCommandInherited.mockReturnValueOnce(4)
    expect(() => runConfiguredStep(runtime, { label: 'Fails', command: 'node', args: ['x'] })).toThrow('exit')
    expect(exit).toHaveBeenCalledWith(4)
  })
})

describe('upgrade cooldown', () => {
  it('ignores GitHub Actions reported by pnpm outdated', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'))
    const infoLines: string[] = []
    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      infoLines.push(String(message ?? ''))
      return undefined
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), ['packages:', '  - "."', ''].join('\n'))
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
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
            dependencyType: 'dependencies',
            dependentPackages: [{ location: root }],
          },
          'actions/cache': {
            current: '4.3.0',
            latest: '6.1.0',
            dependencyType: 'githubAction',
            dependentPackages: [{ location: root }],
          },
        }), 1)
      }

      if (args.includes('ncu') && args.includes('--jsonUpgraded')) {
        return bufferedResult(JSON.stringify({ 'package.json': { 'stable-dep': '^1.2.0' } }))
      }

      if (args.includes('view')) {
        const packageName = args[args.indexOf('view') + 1]
        if (packageName !== 'stable-dep') throw new Error(`Unexpected release metadata request: ${packageName}`)
        return bufferedResult(JSON.stringify({
          '1.2.0': '2026-05-01T12:00:00.000Z',
        }))
      }

      throw new Error(`Unexpected buffered command: ${spec.command} ${(spec.args ?? []).join(' ')}`)
    })
    processMocks.runCommandInherited.mockImplementation((spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('ncu') && args.includes('-u')) return 0
      if (args.includes('install')) return 0
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
    }, ['--yes'])

    const output = stripAnsi(infoLines.join('\n'))
    expect(output).toContain('stable-dep: ^1.0.0 -> ^1.2.0')
    expect(output).not.toContain('actions/cache')
  })

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

  it('reads npm release metadata when npm warnings are printed around the JSON payload', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), ['packages:', '  - "."', ''].join('\n'))
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
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
        return bufferedResult(JSON.stringify({ 'package.json': { 'stable-dep': '^1.2.0' } }))
      }

      if (args.includes('view')) {
        return bufferedResult([
          'npm warn Unknown project config "auto-install-peers".',
          JSON.stringify({
            '1.2.0': '2026-05-01T12:00:00.000Z',
          }),
          'npm warn Unknown project config "strict-peer-dependencies".',
        ].join('\n'))
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
    expect(inheritedArgs.some((args: string[]) => args.includes('ncu') && args.includes('-u'))).toBe(true)
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

  it('reports skipped packages by cooldown, major, and protected singleton without duplicates', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'))
    const infoLines: string[] = []
    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      infoLines.push(String(message ?? ''))
      return undefined
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), [
      'packages:',
      '  - "."',
      'overrides:',
      '  protected-hold: ^1.0.0',
      '  protected-major: ^1.0.0',
      '  protected-recent: ^1.0.0',
      '',
    ].join('\n'))
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: {
        'stable-update': '^1.0.0',
        'cooldown-dep': '^1.0.0',
        'protected-hold': '^1.0.0',
        'protected-major': '^1.0.0',
        'protected-recent': '^1.0.0',
      },
    }))

    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : null

      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({
          'stable-update': {
            current: '1.0.0',
            latest: '1.2.0',
            dependentPackages: [{ location: root }],
          },
          'cooldown-dep': {
            current: '1.0.0',
            latest: '1.1.0',
            dependentPackages: [{ location: root }],
          },
          'protected-hold': {
            current: '1.0.0',
            latest: '1.3.0',
            dependentPackages: [{ location: root }],
          },
          'protected-major': {
            current: '1.0.0',
            latest: '2.0.0',
            dependentPackages: [{ location: root }],
          },
          'protected-recent': {
            current: '1.0.0',
            latest: '1.1.0',
            dependentPackages: [{ location: root }],
          },
        }), 1)
      }

      if (args.includes('ncu') && args.includes('--jsonUpgraded')) {
        const rejects = args.includes('--reject') ? args[args.indexOf('--reject') + 1].split(',') : []
        const updates: Record<string, string> = {}
        const assignIfAllowed = (packageName: string, version: string): void => {
          if (!rejects.includes(packageName)) updates[packageName] = version
        }

        assignIfAllowed('stable-update', '^1.2.0')
        assignIfAllowed('cooldown-dep', '^1.1.0')
        assignIfAllowed('protected-hold', '^1.3.0')
        assignIfAllowed('protected-recent', '^1.1.0')
        if (target === 'latest') assignIfAllowed('protected-major', '^2.0.0')
        return bufferedResult(JSON.stringify({ 'package.json': updates }))
      }

      if (args.includes('view')) {
        const packageName = args[args.indexOf('view') + 1]
        const timesByPackage: Record<string, Record<string, string>> = {
          'stable-update': { '1.2.0': '2026-05-01T12:00:00.000Z' },
          'cooldown-dep': { '1.1.0': '2026-06-16T12:00:00.000Z' },
          'protected-hold': { '1.3.0': '2026-05-10T12:00:00.000Z' },
          'protected-recent': { '1.1.0': '2026-06-16T12:00:00.000Z' },
        }
        return bufferedResult(JSON.stringify(timesByPackage[packageName] ?? {}))
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
          protectedDependencyUpstreamHints: {
            'protected-hold': ['shared-upstream'],
          },
        },
      }),
    }, ['--yes'])

    const output = stripAnsi(infoLines.join('\n'))
    expect(output).toContain('Not updated')
    expect(output).toContain('Cooldown')
    expect(output).toContain('Major')
    expect(output).toContain('Protected singleton')
    expect(output).toContain('cooldown-dep: ^1.0.0 -> ^1.1.0')
    expect(output).toContain('protected-recent: ^1.0.0 -> ^1.1.0')
    expect(output).toContain('protected-major: ^1.0.0 -> ^2.0.0')
    expect(output).toContain('protected-hold: ^1.0.0 -> ^1.3.0')
    expect(output).toContain('protected-hold: review/update shared-upstream before upgrading.')
    expect(countMatches(output, 'protected-recent: ^1.0.0 -> ^1.1.0')).toBe(1)
    expect(countMatches(output, 'protected-major: ^1.0.0 -> ^2.0.0')).toBe(1)
  })
})

describe('upgrade failure and empty paths', () => {
  it('completes with no candidates, cooldown enabled, and verbose output', async () => {
    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({}))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => (
      (spec.args ?? []).includes('outdated') ? bufferedResult('{}') : bufferedResult('{}')
    ))

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, ['--yes', '--verbose'])

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('No eligible dependency updates'))
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('target=minor'))
  })

  it('rejects invalid outdated and ncu command exits before changing manifests', async () => {
    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({}))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      return args.includes('outdated') ? bufferedResult('outdated failed', 2) : bufferedResult('{}')
    })
    await expect(runUpgradeEngine({ cwd: root, config: mergeConfig() }, ['--yes', '--no-cooldown']))
      .rejects.toThrow('pnpm outdated')

    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      return args.includes('ncu') ? bufferedResult('ncu failed', 2) : bufferedResult('{}')
    })
    await expect(runUpgradeEngine({ cwd: root, config: mergeConfig() }, ['--yes', '--no-cooldown']))
      .rejects.toThrow('Command failed')
  })

  it('wraps install failures after manifest updates', async () => {
    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { dep: '^1.0.0' },
    }))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({
          dep: {
            current: '1.0.0',
            latest: '1.1.0',
            dependentPackages: [{ location: root }],
          },
        }), 1)
      }
      return bufferedResult(JSON.stringify({ 'package.json': { dep: '^1.1.0' } }))
    })
    processMocks.runCommandInherited.mockImplementation((spec: CommandSpec) => (
      (spec.args ?? []).includes('install') ? 2 : 0
    ))

    await expect(runUpgradeEngine({ cwd: root, config: mergeConfig() }, ['--yes', '--no-cooldown']))
      .rejects.toThrow('Dependency install failed after manifest updates')
  })

  it('reports a protected singleton without upstream hints', async () => {
    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'overrides:\n  singleton: ^1.0.0\n')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { singleton: '^1.0.0' },
    }))
    const info: string[] = []
    vi.spyOn(console, 'info').mockImplementation((value?: unknown) => {
      info.push(String(value ?? ''))
    })
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({
          singleton: {
            current: '1.0.0',
            latest: '1.1.0',
            dependentPackages: [{ location: root }],
          },
        }), 1)
      }
      const rejects = args.includes('--reject') ? args[args.indexOf('--reject') + 1].split(',') : []
      return bufferedResult(JSON.stringify({
        'package.json': rejects.includes('singleton') ? {} : { singleton: '^1.1.0' },
      }))
    })

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, ['--yes', '--no-cooldown'])

    expect(stripAnsi(info.join('\n'))).toContain('Protected singleton')
  })

  it('keeps nullable current versions for cooldown and major-only candidates', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'))
    const cooldownRoot = await createTempRoot()
    await writeFile(path.join(cooldownRoot, 'package.json'), JSON.stringify({}))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('view')) {
        return bufferedResult('{"1.1.0":"2026-06-16T12:00:00.000Z"}')
      }
      const rejects = args.includes('--reject') ? args[args.indexOf('--reject') + 1].split(',') : []
      if (rejects.includes('ghost')) return bufferedResult('{}')
      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({
          ghost: {
            current: '1.0.0',
            latest: '1.1.0',
            dependentPackages: [{ location: cooldownRoot }],
          },
        }), 1)
      }
      return bufferedResult('{"package.json":{"ghost":"^1.1.0"}}')
    })
    await runUpgradeEngine({ cwd: cooldownRoot, config: mergeConfig() }, ['--yes'])

    const majorRoot = await createTempRoot()
    await writeFile(path.join(majorRoot, 'package.json'), JSON.stringify({}))
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : null
      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({
          ghost: {
            current: '1.0.0',
            latest: '2.0.0',
            dependentPackages: [{ location: majorRoot }],
          },
        }), 1)
      }
      return bufferedResult(target === 'latest' ? '{"package.json":{"ghost":"^2.0.0"}}' : '{}')
    })
    await runUpgradeEngine({ cwd: majorRoot, config: mergeConfig() }, ['--yes', '--no-cooldown'])

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('?'))
  })

  it('uses default protected settings and skips an absent singleton guard', async () => {
    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'overrides:\n  singleton: ^1.0.0\n')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({}))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({
          singleton: {
            current: '1.0.0',
            latest: '1.1.0',
            dependentPackages: [{ location: root }],
          },
        }), 1)
      }
      const rejects = args.includes('--reject') ? args[args.indexOf('--reject') + 1].split(',') : []
      return bufferedResult(JSON.stringify({
        'package.json': rejects.includes('singleton') ? {} : { singleton: '^1.1.0' },
      }))
    })
    processMocks.runCommandInherited.mockReturnValue(0)

    await runUpgradeEngine({
      cwd: root,
      config: { ...mergeConfig(), upgrade: undefined },
    }, ['--yes', '--no-cooldown', '--major', '--isolated'])

    expect(readProtectedOverrides(root, 'pnpm-workspace.yaml').singleton).toBe('^1.1.0')
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

  it('omits major skip reporting when --major is enabled and upgrades protected singletons with --isolated', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'))
    const infoLines: string[] = []
    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      infoLines.push(String(message ?? ''))
      return undefined
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), [
      'packages:',
      '  - "."',
      'overrides:',
      '  protected-major: ^1.0.0',
      '',
    ].join('\n'))
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: {
        'protected-major': '^1.0.0',
      },
    }))

    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : null

      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({
          'protected-major': {
            current: '1.0.0',
            latest: '2.0.0',
            dependentPackages: [{ location: root }],
          },
        }), 1)
      }

      if (args.includes('ncu') && args.includes('--jsonUpgraded')) {
        const updates = target === 'latest' ? { 'protected-major': '^2.0.0' } : {}
        return bufferedResult(JSON.stringify({ 'package.json': updates }))
      }

      throw new Error(`Unexpected buffered command: ${spec.command} ${(spec.args ?? []).join(' ')}`)
    })
    processMocks.runCommandInherited.mockImplementation((spec: CommandSpec) => {
      const args = spec.args ?? []

      if (args.includes('ncu') && args.includes('-u')) return 0
      if (args.includes('install')) return 0
      if (args.includes('guard')) return 0
      throw new Error(`Unexpected inherited command: ${spec.command} ${args.join(' ')}`)
    })

    await runUpgradeEngine({
      cwd: root,
      config: mergeConfig({
        upgrade: {
          defaultCooldownDays: 0,
          protectedOverridesFile: 'pnpm-workspace.yaml',
          singletonGuardCommand: { label: 'Guard', command: 'node', args: ['guard'] },
        },
      }),
    }, ['--yes', '--major', '--isolated'])

    const output = stripAnsi(infoLines.join('\n'))
    expect(output).not.toContain('Not updated')
    expect(output).not.toContain('Major')
    expect(output).toContain('Protected singleton upgrades')
    expect(output).toContain('protected-major: ^1.0.0 -> ^2.0.0')
  })
})
