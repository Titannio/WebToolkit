import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  cancel: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  isCancel: vi.fn((value: unknown) => typeof value === 'symbol'),
  multiselect: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
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

vi.mock('@clack/prompts', () => promptMocks)

import {
  applyManifestVersionStyle,
  addSkippedEntries,
  buildProtectedUpgradePlans,
  classifyUpgradeEntries,
  deriveProtectedOverrideTargetVersion,
  getReleaseDate,
  getUpgradeType,
  getVersionMajor,
  normalizeNcuJson,
  normalizePnpmOutdatedJson,
  parseCliArgs,
  parseUpgradeTypes,
  parseJsonObjectFromCommandOutput,
  parsePnpmPackageManagerVersion,
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
  for (const mock of Object.values(promptMocks)) mock.mockReset()
  promptMocks.isCancel.mockImplementation((value: unknown) => typeof value === 'symbol')
  if (originalInputIsTTY) Object.defineProperty(input, 'isTTY', originalInputIsTTY)
  else delete (input as { isTTY?: boolean }).isTTY
  if (originalOutputIsTTY) Object.defineProperty(output, 'isTTY', originalOutputIsTTY)
  else delete (output as { isTTY?: boolean }).isTTY
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('upgrade prompts', () => {
  it('resolves CLI flags and keyboard prompt selections', async () => {
    const runtime = { cwd: '/repo', config: mergeConfig({ upgrade: { defaultCooldownDays: 9 } }) }
    expect(parseCliArgs(runtime, ['--latest', '--verbose', '--align-protected-singletons', '--days=3', '--dry-run'])).toEqual({
      types: ['major', 'minor', 'patch'],
      verbose: true,
      alignProtectedSingletons: true,
      days: 3,
      dryRun: true,
      interactive: false,
    })
    expect(parseCliArgs(runtime, ['--types=patch,major'])).toMatchObject({ types: ['major', 'patch'] })
    expect(parseUpgradeTypes('all')).toEqual(['major', 'minor', 'patch'])
    expect(() => parseUpgradeTypes('major,unknown')).toThrow('Invalid --types')
    expect(() => parseUpgradeTypes('major,major')).toThrow('Invalid --types')
    expect(parseCliArgs(runtime, ['--no-cooldown'])).toMatchObject({ days: 0 })
    expect(() => parseCliArgs(runtime, ['--days=invalid'])).toThrow('Invalid --days value')
    expect(() => parseCliArgs(runtime, ['--unexpected'])).toThrow('Unknown upgrade option')
    expect(() => parseCliArgs(runtime, ['--days=3', '--days=7'])).toThrow('Use --days only once')
    expect(() => parseCliArgs(runtime, ['--types=minor', '--types=patch'])).toThrow('Use --types only once')
    expect(() => parseCliArgs(runtime, ['--days=3', '--no-cooldown'])).toThrow('either --days or --no-cooldown')
    expect(() => parseCliArgs(runtime, ['--types=patch', '--major'])).toThrow('either --types or --major/--latest')

    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    promptMocks.select.mockResolvedValueOnce('custom').mockResolvedValueOnce(3)
    promptMocks.multiselect.mockResolvedValueOnce(['major', 'patch'])
    promptMocks.confirm.mockResolvedValueOnce(true)

    await expect(resolveOptions(runtime, [])).resolves.toEqual({
      types: ['major', 'patch'],
      verbose: false,
      alignProtectedSingletons: true,
      days: 3,
      dryRun: false,
      interactive: true,
    })
    expect(promptMocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ initialValue: true }))

    promptMocks.select.mockResolvedValueOnce('all').mockResolvedValueOnce(7)
    promptMocks.confirm.mockResolvedValueOnce(false)
    await expect(resolveOptions({ cwd: '/repo', config: mergeConfig({ upgrade: { defaultCooldownDays: 7 } }) }, ['--latest'])).resolves.toMatchObject({
      types: ['major', 'minor', 'patch'],
      days: 7,
      alignProtectedSingletons: false,
    })

    promptMocks.select.mockResolvedValueOnce('custom').mockResolvedValueOnce(7)
    promptMocks.multiselect.mockResolvedValueOnce(['major', 'patch'])
    promptMocks.confirm.mockResolvedValueOnce(false)
    await expect(resolveOptions({ cwd: '/repo', config: mergeConfig({ upgrade: { defaultCooldownDays: 7 } }) }, ['--types=major,patch'])).resolves.toMatchObject({
      types: ['major', 'patch'],
    })

    promptMocks.select.mockResolvedValueOnce(Symbol('cancel'))
    await expect(resolveOptions(runtime, [])).resolves.toBeNull()

    promptMocks.select.mockResolvedValueOnce(Symbol('cancel'))
    await runUpgradeEngine(runtime, [])
    expect(promptMocks.cancel).toHaveBeenCalledWith('Upgrade cancelled.')

    promptMocks.select.mockResolvedValueOnce('custom')
    promptMocks.multiselect.mockResolvedValueOnce(Symbol('cancel'))
    await expect(resolveOptions(runtime, [])).resolves.toBeNull()

    promptMocks.select.mockResolvedValueOnce('recommended').mockResolvedValueOnce(Symbol('cancel'))
    await expect(resolveOptions(runtime, [])).resolves.toBeNull()

    promptMocks.select.mockResolvedValueOnce('recommended').mockResolvedValueOnce(0)
    promptMocks.confirm.mockResolvedValueOnce(Symbol('cancel'))
    await expect(resolveOptions(runtime, [])).resolves.toBeNull()
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
    const reportBase = { ...base, type: 'major' as const, releaseDate: null }
    addSkippedEntries(skipped, [{ ...reportBase, reason: 'protected-singleton' }])
    addSkippedEntries(skipped, [{ ...reportBase, reason: 'not-selected' }])
    addSkippedEntries(skipped, [{ ...reportBase, reason: 'cooldown' }])
    addSkippedEntries(skipped, [{ ...reportBase, reason: 'protected-singleton' }])
    expect(skipped.get('package.json::dep')).toMatchObject({ reason: 'cooldown' })
    expect(getUpgradeType('1.0.0', '2.0.0')).toBe('major')
    expect(getUpgradeType('1.0.0', '1.1.0')).toBe('minor')
    expect(getUpgradeType('1.0.0', '1.0.1-beta.0')).toBe('patch')
    expect(getUpgradeType('workspace:*', '1.0.0')).toBeNull()
    expect(getUpgradeType('1.0.0', '1.0.0')).toBeNull()
    expect(classifyUpgradeEntries([{ ...base, currentVersion: '1.0.0', targetVersion: '1.0.1' }])).toMatchObject([{ type: 'patch' }])
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

    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    processMocks.runCommandBuffered.mockResolvedValueOnce(bufferedResult('{"1.0.0":"2026-01-01T00:00:00.000Z"}'))
    await getReleaseDate(runtime, 'pkg', '1.0.0')
    expect(processMocks.runCommandBuffered).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: 'npm' }),
      '/repo',
    )

    platform.mockReturnValue('win32')
    processMocks.runCommandBuffered.mockResolvedValueOnce(bufferedResult('{"1.0.0":"2026-01-01T00:00:00.000Z"}'))
    await getReleaseDate(runtime, 'pkg', '1.0.0')
    expect(processMocks.runCommandBuffered).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: 'npm.cmd' }),
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
    expect(output).toContain('stable-dep | root      | ^1.0.0 -> ^1.2.0')
    expect(output).toContain('2026-05-01 (47 days ago)')
    expect(output).not.toContain('actions/cache')
  })

  it('prints a dry-run preview without applying updates', async () => {
    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { dep: '^1.0.0' } }))
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({ dep: {
          current: '1.0.0', latest: '1.0.1', dependentPackages: [{ location: root }],
        } }), 1)
      }
      if (args.includes('ncu')) return bufferedResult('{"package.json":{"dep":"^1.0.1"}}')
      if (args.includes('view')) return bufferedResult('{"1.0.1":"2026-06-17T12:00:00.000Z"}')
      throw new Error(`Unexpected buffered command: ${spec.command} ${(spec.args ?? []).join(' ')}`)
    })

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, ['--yes', '--no-cooldown', '--dry-run'])

    expect(processMocks.runCommandInherited).not.toHaveBeenCalled()
    expect(promptMocks.outro).toHaveBeenCalledWith('Dry run complete. No files changed.')
  })

  it('uses workspace names and orders report rows by oldest release first', async () => {
    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { newer: '^1.0.0', unknown: '^1.0.0', shared: '^1.0.0' } }))
    await mkdir(path.join(root, 'packages', 'core'), { recursive: true })
    await writeFile(path.join(root, 'packages', 'core', 'package.json'), JSON.stringify({ dependencies: { older: '^1.0.0', shared: '^1.0.0' } }))
    const infoLines: string[] = []
    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      infoLines.push(String(message ?? ''))
    })
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({
          newer: { current: '1.0.0', latest: '1.1.0', dependentPackages: [{ location: root }] },
          older: { current: '1.0.0', latest: '1.1.0', dependentPackages: [{ location: path.join(root, 'packages', 'core') }] },
          shared: { current: '1.0.0', latest: '1.1.0', dependentPackages: [{ location: root }, { location: path.join(root, 'packages', 'core') }] },
          unknown: { current: '1.0.0', latest: '1.1.0', dependentPackages: [{ location: root }] },
        }), 1)
      }
      if (args.includes('ncu')) return bufferedResult(JSON.stringify({
        'package.json': { newer: '^1.1.0', unknown: '^1.1.0', shared: '^1.1.0' },
        'packages/core/package.json': { older: '^1.1.0', shared: '^1.1.0' },
      }))
      if (args.includes('view')) {
        const packageName = args[args.indexOf('view') + 1]
        if (packageName === 'unknown') return bufferedResult('{}')
        return bufferedResult(JSON.stringify({ '1.1.0': packageName === 'older' ? '2026-01-01T12:00:00.000Z' : '2026-06-01T12:00:00.000Z' }))
      }
      throw new Error(`Unexpected buffered command: ${spec.command} ${(spec.args ?? []).join(' ')}`)
    })

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, ['--yes', '--no-cooldown', '--dry-run'])

    const output = stripAnsi(infoLines.join('\n'))
    expect(output).toContain('older   | core')
    expect(output).toContain('newer   | root')
    expect(output).toContain('unknown | root')
    expect(output.indexOf('older   | core')).toBeLessThan(output.indexOf('newer   | root'))
    expect(output.indexOf('newer   | root')).toBeLessThan(output.indexOf('unknown | root'))
    expect(countMatches(output, 'shared')).toBe(1)
  })

  it('selects cooldown exceptions by package across workspaces', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'))
    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    promptMocks.select.mockResolvedValueOnce('all').mockResolvedValueOnce(7)
    promptMocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true)
    promptMocks.multiselect.mockResolvedValueOnce(['major-dep']).mockResolvedValueOnce(['major-dep'])

    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {
      'major-dep': '^1.0.0',
      'minor-dep': '^1.0.0',
      'patch-dep': '^1.0.0',
      mixed: '^1.0.0',
    } }))
    await mkdir(path.join(root, 'packages', 'core'), { recursive: true })
    await writeFile(path.join(root, 'packages', 'core', 'package.json'), JSON.stringify({ dependencies: { mixed: '^2.0.0' } }))
    const infoLines: string[] = []
    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      infoLines.push(String(message ?? ''))
    })
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) return bufferedResult('{}')
      if (args.includes('ncu')) return bufferedResult(JSON.stringify({
        'package.json': {
          'major-dep': '^2.0.0',
          'minor-dep': '^1.1.0',
          'patch-dep': '^1.0.1',
          mixed: '^2.0.0',
        },
        'packages/core/package.json': { mixed: '^2.1.0' },
      }))
      if (args.includes('view')) return bufferedResult(JSON.stringify({
        '1.0.1': '2026-06-15T12:00:00.000Z',
        '1.1.0': '2026-06-15T12:00:00.000Z',
        '2.0.0': '2026-06-15T12:00:00.000Z',
        '2.1.0': '2026-06-15T12:00:00.000Z',
      }))
      throw new Error(`Unexpected buffered command: ${spec.command} ${(spec.args ?? []).join(' ')}`)
    })
    processMocks.runCommandInherited.mockImplementation((spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('ncu') || args.includes('install')) return 0
      throw new Error(`Unexpected inherited command: ${spec.command} ${args.join(' ')}`)
    })

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, [])

    expect(promptMocks.multiselect).toHaveBeenNthCalledWith(1, expect.objectContaining({
      message: 'Select major updates',
      required: false,
      options: [
        expect.objectContaining({ value: 'major-dep', hint: 'Major - Workspaces: root' }),
        expect.objectContaining({ value: 'mixed', hint: 'Major - Workspaces: root' }),
      ],
    }))
    expect(promptMocks.multiselect).toHaveBeenNthCalledWith(2, expect.objectContaining({
      message: 'Select cooldown exceptions',
      required: false,
      options: [
        expect.objectContaining({ value: 'major-dep', hint: 'Major - Workspaces: root' }),
        expect.objectContaining({ value: 'minor-dep', hint: 'Minor - Workspaces: root' }),
        expect.objectContaining({ value: 'mixed', hint: 'Minor - Workspaces: core' }),
        expect.objectContaining({ value: 'patch-dep', hint: 'Patch - Workspaces: root' }),
      ],
    }))
    const updateCall = processMocks.runCommandInherited.mock.calls
      .map((call) => call[0] as CommandSpec)
      .find((spec) => spec.args?.includes('ncu'))
    expect(updateCall?.args).toEqual(expect.arrayContaining(['--filter', 'major-dep', '--reject', 'minor-dep,mixed,patch-dep']))
    const reportOutput = stripAnsi(infoLines.join('\n'))
    const finalReviewStart = reportOutput.indexOf('Final review: updates to apply')
    const finalReview = reportOutput.slice(finalReviewStart, reportOutput.indexOf('Applying dependency updates...', finalReviewStart))
    expect(finalReview).toContain('Final review: updates to apply')
    expect(finalReview).toContain('major-dep | root')
    expect(finalReview).toContain('Final review: Cooldown')
    expect(finalReview).toContain('minor-dep | root')
    expect(finalReview).toContain('mixed     | core')
    expect(finalReview).toContain('patch-dep | root')
    expect(finalReview).toContain('Final review: Not selected')
    expect(reportOutput).toContain('Preview: Cooldown')
    expect(reportOutput).toContain('\nNot updated\n')
  })

  it('runs the cooldown selector in interactive dry runs without applying updates', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'))
    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    promptMocks.select.mockResolvedValueOnce('recommended').mockResolvedValueOnce(7)
    promptMocks.confirm.mockResolvedValueOnce(false)
    promptMocks.multiselect.mockResolvedValueOnce([])

    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { dep: '^1.0.0' } }))
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) return bufferedResult('{}')
      if (args.includes('ncu')) return bufferedResult('{"package.json":{"dep":"^1.1.0"}}')
      if (args.includes('view')) return bufferedResult('{"1.1.0":"2026-06-15T12:00:00.000Z"}')
      throw new Error(`Unexpected buffered command: ${spec.command} ${(spec.args ?? []).join(' ')}`)
    })

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, ['--dry-run'])

    expect(promptMocks.multiselect).toHaveBeenCalledTimes(1)
    expect(processMocks.runCommandInherited).not.toHaveBeenCalled()
    expect(promptMocks.outro).toHaveBeenCalledWith('Dry run complete. No files changed.')
  })

  it('cancels when selecting cooldown exceptions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'))
    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    promptMocks.select.mockResolvedValueOnce('recommended').mockResolvedValueOnce(7)
    promptMocks.confirm.mockResolvedValueOnce(false)
    promptMocks.multiselect.mockResolvedValueOnce(Symbol('cancel'))

    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { dep: '^1.0.0' } }))
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) return bufferedResult('{}')
      if (args.includes('ncu')) return bufferedResult('{"package.json":{"dep":"^1.1.0"}}')
      if (args.includes('view')) return bufferedResult('{"1.1.0":"2026-06-15T12:00:00.000Z"}')
      throw new Error(`Unexpected buffered command: ${spec.command} ${(spec.args ?? []).join(' ')}`)
    })

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, [])

    expect(processMocks.runCommandInherited).not.toHaveBeenCalled()
    expect(promptMocks.cancel).toHaveBeenCalledWith('Upgrade cancelled.')
  })

  it('cancels when selecting major updates', async () => {
    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    promptMocks.select.mockResolvedValueOnce('all').mockResolvedValueOnce(0)
    promptMocks.confirm.mockResolvedValueOnce(false)
    promptMocks.multiselect.mockResolvedValueOnce(Symbol('cancel'))

    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { dep: '^1.0.0' } }))
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => (
      (spec.args ?? []).includes('ncu') ? bufferedResult('{"package.json":{"dep":"^2.0.0"}}') : bufferedResult('{}')
    ))

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, [])

    expect(processMocks.runCommandInherited).not.toHaveBeenCalled()
    expect(promptMocks.cancel).toHaveBeenCalledWith('Upgrade cancelled.')
  })

  it('cancels an interactive upgrade after its preview without changing files', async () => {
    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    promptMocks.select.mockResolvedValueOnce('recommended').mockResolvedValueOnce(0)
    promptMocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(false)

    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { dep: '^1.0.0' } }))
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) {
        return bufferedResult(JSON.stringify({ dep: {
          current: '1.0.0', latest: '1.0.1', dependentPackages: [{ location: root }],
        } }), 1)
      }
      return bufferedResult('{"package.json":{"dep":"^1.0.1"}}')
    })

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, [])

    expect(processMocks.runCommandInherited).not.toHaveBeenCalled()
    expect(promptMocks.cancel).toHaveBeenCalledWith('Upgrade cancelled.')
  })

  it('handles an interactive confirmation cancellation', async () => {
    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    promptMocks.select.mockResolvedValueOnce('recommended').mockResolvedValueOnce(0)
    promptMocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(Symbol('cancel'))

    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { dep: '^1.0.0' } }))
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      if ((spec.args ?? []).includes('outdated')) {
        return bufferedResult(JSON.stringify({ dep: {
          current: '1.0.0', latest: '1.0.1', dependentPackages: [{ location: root }],
        } }), 1)
      }
      return bufferedResult('{"package.json":{"dep":"^1.0.1"}}')
    })

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, [])

    expect(promptMocks.cancel).toHaveBeenCalledWith('Upgrade cancelled.')
  })

  it('applies a confirmed interactive upgrade', async () => {
    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    promptMocks.select.mockResolvedValueOnce('recommended').mockResolvedValueOnce(0)
    promptMocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const root = await createTempRoot()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { dep: '^1.0.0' } }))
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      if ((spec.args ?? []).includes('outdated')) {
        return bufferedResult(JSON.stringify({ dep: {
          current: '1.0.0', latest: '1.0.1', dependentPackages: [{ location: root }],
        } }), 1)
      }
      return bufferedResult('{"package.json":{"dep":"^1.0.1"}}')
    })
    processMocks.runCommandInherited.mockReturnValue(0)

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, [])

    expect(processMocks.runCommandInherited).toHaveBeenCalledWith(expect.objectContaining({ args: expect.arrayContaining(['-u', '--filter', 'dep']) }), root)
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
    expect(ncuUpgradeCommands.some((args: string[]) => args[args.indexOf('--filter') + 1]?.includes('fresh-singleton'))).toBe(false)
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
    expect(output).toMatch(/cooldown-dep\s+\| root/u)
    expect(output).toMatch(/protected-recent\s+\| root/u)
    expect(output).toMatch(/protected-major\s+\| root/u)
    expect(output).toMatch(/protected-hold\s+\| root/u)
    expect(output).toContain('protected-hold: review/update shared-upstream before upgrading.')
    expect(countMatches(output, 'protected-recent')).toBe(2)
    expect(countMatches(output, 'protected-major')).toBe(2)
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
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('types=minor,patch'))
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

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('No eligible dependency updates'))
  })

  it('uses default protected settings and skips an absent singleton guard', async () => {
    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'overrides:\n  singleton: ^1.0.0\n')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { singleton: '^1.0.0' } }))
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

  it('does not offer a protected upgrade declined during interactive configuration', async () => {
    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    promptMocks.select.mockResolvedValueOnce('recommended').mockResolvedValueOnce(0)
    promptMocks.confirm.mockResolvedValueOnce(false)

    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'overrides:\n  singleton: ^1.0.0\n')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { singleton: '^1.0.0' } }))
    const infoLines: string[] = []
    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      infoLines.push(String(message ?? ''))
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) return bufferedResult('{}')
      if (args.includes('ncu')) return bufferedResult('{"package.json":{"singleton":"^1.1.0"}}')
      if (args.includes('view')) return bufferedResult('{"1.1.0":"2026-06-01T00:00:00.000Z"}')
      throw new Error(`Unexpected buffered command: ${spec.command} ${args.join(' ')}`)
    })

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, [])

    expect(promptMocks.multiselect).not.toHaveBeenCalled()
    expect(promptMocks.confirm).toHaveBeenCalledTimes(1)
    expect(processMocks.runCommandInherited).not.toHaveBeenCalled()
    expect(stripAnsi(infoLines.join('\n'))).toContain('No eligible dependency updates')
  })

  it('offers cooldown exceptions only for upgrades the user allowed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'))
    Object.defineProperty(input, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(output, 'isTTY', { configurable: true, value: true })
    promptMocks.select.mockResolvedValueOnce('recommended').mockResolvedValueOnce(7)
    promptMocks.confirm.mockResolvedValueOnce(false)
    promptMocks.multiselect.mockResolvedValueOnce([])

    const root = await createTempRoot()
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'overrides:\n  singleton: ^1.0.0\n')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { regular: '^1.0.0', singleton: '^1.0.0' } }))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) return bufferedResult('{}')
      if (args.includes('ncu')) return bufferedResult('{"package.json":{"regular":"^1.1.0","singleton":"^1.1.0"}}')
      if (args.includes('view')) return bufferedResult('{"1.1.0":"2026-06-16T12:00:00.000Z"}')
      throw new Error(`Unexpected buffered command: ${spec.command} ${args.join(' ')}`)
    })

    await runUpgradeEngine({ cwd: root, config: mergeConfig() }, [])

    expect(promptMocks.multiselect).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Select cooldown exceptions',
      options: [expect.objectContaining({ value: 'regular' })],
    }))
    expect(promptMocks.confirm).toHaveBeenCalledTimes(1)
    expect(processMocks.runCommandInherited).not.toHaveBeenCalled()
  })

  it('preflights protected singleton targets before applying regular upgrades', async () => {
    const root = await createTempRoot()
    const core = path.join(root, 'packages', 'core')
    await mkdir(core, { recursive: true })
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'overrides:\n  singleton: ^1.0.0\n')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { stable: '^1.0.0', singleton: '^1.0.0' } }))
    await writeFile(path.join(core, 'package.json'), JSON.stringify({ dependencies: { singleton: '^1.0.0' } }))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    processMocks.runCommandBuffered.mockImplementation(async (spec: CommandSpec) => {
      const args = spec.args ?? []
      if (args.includes('outdated')) return bufferedResult('{}')
      if (args.includes('ncu')) return bufferedResult(JSON.stringify({
        'package.json': { stable: '^1.1.0', singleton: '^2.0.0' },
        'packages/core/package.json': { singleton: '^3.0.0' },
      }))
      if (args.includes('view')) return bufferedResult('{}')
      throw new Error(`Unexpected buffered command: ${spec.command} ${args.join(' ')}`)
    })

    await expect(runUpgradeEngine({ cwd: root, config: mergeConfig() }, ['--yes', '--no-cooldown', '--major', '--isolated']))
      .rejects.toThrow('Protected singleton upgrade target is ambiguous')

    expect(processMocks.runCommandInherited).not.toHaveBeenCalled()
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
    expect(output).toContain('Major')
    expect(output).toContain('Protected singleton upgrades')
    expect(output).toContain('protected-major | root')
  })
})
