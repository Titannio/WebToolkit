import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  runConfigReference: vi.fn(),
  runArchitectureMap: vi.fn(),
  parseCleanArgs: vi.fn(() => ({ level: 'cache' })),
  runCleaner: vi.fn(),
  printGuardHelp: vi.fn(),
  runBuiltinGuard: vi.fn(),
  runWorkspaceTests: vi.fn(),
  runRepoCheck: vi.fn(),
  runWorkspaceCoverage: vi.fn(),
  runWorkspaceTestTask: vi.fn(),
  runReleaseGate: vi.fn(),
  runValidateEngine: vi.fn(),
  runJSDocReport: vi.fn(),
  runUpgradeEngine: vi.fn(),
  runBundleAudit: vi.fn(),
  runDevWatch: vi.fn(),
  runE2eTests: vi.fn(),
  runDevGrid: vi.fn(),
  runReadyService: vi.fn(),
  runEnvBootstrap: vi.fn(),
  runEnvDoctor: vi.fn(),
  resolveTaskName: vi.fn(),
  runTask: vi.fn(),
  listTaskCommands: vi.fn(() => ['build']),
  printTaskHelp: vi.fn(),
}))

vi.mock('./config.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./config.js')>(),
  loadConfig: mocks.loadConfig,
}))
vi.mock('./config-reference.js', () => ({ runConfigReference: mocks.runConfigReference }))
vi.mock('./architecture-map.js', () => ({ runArchitectureMap: mocks.runArchitectureMap }))
vi.mock('./bundle-audit.js', () => ({ runBundleAudit: mocks.runBundleAudit }))
vi.mock('./cleaner.js', () => ({ parseCleanArgs: mocks.parseCleanArgs, runCleaner: mocks.runCleaner }))
vi.mock('./dev-grid.js', () => ({ runDevGrid: mocks.runDevGrid }))
vi.mock('./dev-watch.js', () => ({ runDevWatch: mocks.runDevWatch }))
vi.mock('./e2e-tests.js', () => ({ runE2eTests: mocks.runE2eTests }))
vi.mock('./environment.js', () => ({ runEnvBootstrap: mocks.runEnvBootstrap, runEnvDoctor: mocks.runEnvDoctor }))
vi.mock('./guard-runner.js', () => ({ printGuardHelp: mocks.printGuardHelp, runBuiltinGuard: mocks.runBuiltinGuard }))
vi.mock('./jsdoc-report.js', () => ({ runJSDocReport: mocks.runJSDocReport }))
vi.mock('./ready-service.js', () => ({ runReadyService: mocks.runReadyService }))
vi.mock('./repo-check.js', () => ({ runRepoCheck: mocks.runRepoCheck }))
vi.mock('./release-gate.js', () => ({ runReleaseGate: mocks.runReleaseGate }))
vi.mock('./tasks.js', () => ({
  listTaskCommands: mocks.listTaskCommands,
  printTaskHelp: mocks.printTaskHelp,
  resolveTaskName: mocks.resolveTaskName,
  runTask: mocks.runTask,
}))
vi.mock('./upgrade.js', () => ({ runUpgradeEngine: mocks.runUpgradeEngine }))
vi.mock('./validate.js', () => ({ runValidateEngine: mocks.runValidateEngine }))
vi.mock('./workspace-tests.js', () => ({
  runWorkspaceCoverage: mocks.runWorkspaceCoverage,
  runWorkspaceTests: mocks.runWorkspaceTests,
  runWorkspaceTestTask: mocks.runWorkspaceTestTask,
}))

import { mergeConfig } from './config.js'
import { main } from './bin.js'

const nativeConfig = mergeConfig({
  bundleAudit: { appDirs: [] },
  devGrid: { layout: { rows: [{ panes: [{ title: 'A', command: 'a' }] }] } },
  devWatch: { apps: { a: { displayName: 'A', port: 1 } }, defaultApps: ['a'] },
  e2eTests: {
    playwrightPackage: '@playwright/test', testDirectory: 'tests/e2e', browser: 'chromium',
    playwright: { config: { testMatch: '**/*.spec.ts' } },
    runner: { command: 'pnpm', args: ['exec', 'playwright', 'test'] }, servers: [{ name: 'App', command: 'pnpm', readinessUrl: 'http://localhost:3000', timeoutMs: 1 }],
  },
  jsdocReport: { includePaths: ['src'] },
  releaseGate: { stages: [{ name: 'test', command: 'npm' }] },
  repoCheck: { steps: [{ label: 'test', command: 'npm' }] },
  tasks: { build: { steps: [{ label: 'build', command: 'npm' }] } },
  upgrade: {},
  validate: { steps: [{ label: 'test', command: 'npm' }] },
  workspaceTests: { workspaces: [] },
})

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if ('mockClear' in mock) mock.mockClear()
  }
  mocks.loadConfig.mockResolvedValue({ config: nativeConfig, configPath: null })
  mocks.resolveTaskName.mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CLI command routing', () => {
  it('prints config without loading repository config', async () => {
    await main(['config', '--json'], '/repo')
    expect(mocks.runConfigReference).toHaveBeenCalledWith(['--json'])
    expect(mocks.loadConfig).not.toHaveBeenCalled()
  })

  it.each([[[]], [['--help']], [['-h']]])('prints root help for %j', async (args) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await main(args, '/repo')
    expect(info).toHaveBeenCalled()
    expect(mocks.listTaskCommands).toHaveBeenCalledWith(nativeConfig)
  })

  it('omits configured tasks when none exist', async () => {
    mocks.listTaskCommands.mockReturnValueOnce([])
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await main([], '/repo')
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('Configured tasks:'))
  })

  it('runs clean', async () => {
    await main(['clean', '--dry-run'], '/repo')
    expect(mocks.parseCleanArgs).toHaveBeenCalledWith(['--dry-run'])
    expect(mocks.runCleaner).toHaveBeenCalled()
  })

  it.each([[['guard']], [['guard', '--help']], [['guard', 'any', '-h']]])('prints guard help for %j', async (args) => {
    await main(args, '/repo')
    expect(mocks.printGuardHelp).toHaveBeenCalled()
  })

  it('runs a guard from the invocation directory', async () => {
    await main(['guard', 'any', '--flag'], '/invocation')
    expect(mocks.runBuiltinGuard).toHaveBeenCalledWith('any', ['--flag'], '/invocation')
  })

  it.each([
    ['test', mocks.runWorkspaceTests],
    ['check', mocks.runRepoCheck],
    ['test-coverage', mocks.runWorkspaceCoverage],
    ['release-gate', mocks.runReleaseGate],
    ['validate', mocks.runValidateEngine],
    ['jsdoc-report', mocks.runJSDocReport],
    ['upgrade', mocks.runUpgradeEngine],
    ['performance-bundle-audit', mocks.runBundleAudit],
    ['dev-watch', mocks.runDevWatch],
    ['test-e2e', mocks.runE2eTests],
    ['dev-grid', mocks.runDevGrid],
    ['wait-service', mocks.runReadyService],
    ['env-bootstrap', mocks.runEnvBootstrap],
    ['env-doctor', mocks.runEnvDoctor],
  ] as const)('runs %s', async (command, runner) => {
    await main([command, '--flag'], '/repo')
    expect(runner).toHaveBeenCalled()
  })

  it('runs architecture-map without command-line configuration', async () => {
    await main(['architecture-map'], '/repo')
    expect(mocks.runArchitectureMap).toHaveBeenCalledWith({ cwd: '/repo', config: nativeConfig })
    await expect(main(['architecture-map', '--output', 'map.html'], '/repo')).rejects.toThrow('Usage:')
  })

  it.each([
    'test',
    'check',
    'test-coverage',
    'architecture-map',
    'release-gate',
    'validate',
    'jsdoc-report',
    'upgrade',
    'performance-bundle-audit',
    'dev-watch',
    'test-e2e',
    'dev-grid',
    'wait-service',
    'env-bootstrap',
    'env-doctor',
  ])('prints command help for %s', async (command) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await main([command, '--help'], '/repo')
    expect(info).toHaveBeenCalled()
  })

  it.each([[['workspace-test']], [['workspace-test', '--help']]])('prints workspace-test help for %j', async (args) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await main(args, '/repo')
    expect(info).toHaveBeenCalledWith(expect.stringContaining('workspace-test'))
  })

  it('runs a workspace test task', async () => {
    await main(['workspace-test', 'test', 'file.test.ts'], '/repo')
    expect(mocks.runWorkspaceTestTask).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo' }), 'test', ['file.test.ts'])
  })

  it('resolves the workspace root from the config path', async () => {
    mocks.loadConfig.mockResolvedValueOnce({ config: nativeConfig, configPath: '/repo/.webtoolkit-cli/config.json' })
    await main(['check'], '/repo/subdir')
    expect(mocks.runRepoCheck).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo', config: nativeConfig }))
  })

  it('runs configured task aliases and their help', async () => {
    mocks.resolveTaskName.mockReturnValue('build')
    await main(['build', '--help'], '/repo')
    expect(mocks.printTaskHelp).toHaveBeenCalledWith('build', nativeConfig)

    await main(['build', '--flag'], '/repo')
    expect(mocks.runTask).toHaveBeenCalledWith('build', expect.objectContaining({ cwd: '/repo' }), ['--flag'])
  })

  it('rejects unknown commands', async () => {
    await expect(main(['unknown'], '/repo')).rejects.toThrow('Unknown command: unknown')
  })
})
