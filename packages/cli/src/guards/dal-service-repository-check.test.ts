import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DalServiceRepositoryGuardConfig } from '../config.js'
import { runDalServiceRepositoryGuard } from './dal-service-repository-check.js'

const roots: string[] = []

function config(): DalServiceRepositoryGuardConfig {
  return {
    sourceDirectory: 'apps/api/src',
    tsconfig: 'apps/api/tsconfig.json',
    layers: [
      { name: 'controller', paths: ['controllers'] },
      { name: 'repository', paths: ['repositories'] },
    ],
    forbiddenDependencies: {
      controller: ['repository'],
      repository: ['controller'],
    },
  }
}

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-dal-'))
  roots.push(directory)
  await mkdir(path.join(directory, 'apps', 'api'), { recursive: true })
  await writeFile(path.join(directory, 'apps', 'api', 'tsconfig.json'), JSON.stringify({
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
  }), 'utf8')
  return directory
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('DAL/service/repository guard', () => {
  it('accepts compliant files and reports forbidden imports', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'controllers'), { recursive: true })
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'repositories'), { recursive: true })
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'repositories', 'user.ts'), 'export const user = 1', 'utf8')
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'controllers', 'clean.ts'), 'export const clean = 1', 'utf8')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(await runDalServiceRepositoryGuard({ rootDir: directory, config: config() })).toBe(0)

    await writeFile(
      path.join(directory, 'apps', 'api', 'src', 'controllers', 'user.ts'),
      "import { user } from '../repositories/user.js'\nexport { user }",
      'utf8',
    )
    await writeFile(
      path.join(directory, 'apps', 'api', 'src', 'repositories', 'user.ts'),
      "import { clean } from '../controllers/clean.js'\nexport const user = clean",
      'utf8',
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await runDalServiceRepositoryGuard({ rootDir: directory, config: config() })).toBe(1)
    expect(log.mock.calls.flat().join('\n')).toContain('controller-forbidden-repository')
  })

  it('honors layer exclusions', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'controllers', 'utils'), { recursive: true })
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'repositories'), { recursive: true })
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'repositories', 'user.ts'), 'export const user = 1', 'utf8')
    await writeFile(
      path.join(directory, 'apps', 'api', 'src', 'controllers', 'utils', 'helper.ts'),
      "import { user } from '../../repositories/user.js'\nexport { user }",
      'utf8',
    )
    const configured = config()
    configured.layers[0].exclude = ['controllers/utils']
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await runDalServiceRepositoryGuard({ rootDir: directory, config: configured })).toBe(0)
  })

  it('honors global directory exclusions', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'ignored'), { recursive: true })
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'ignored', 'file.ts'), 'export {}', 'utf8')
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'controllers'), { recursive: true })
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'controllers', 'clean.ts'), 'export {}', 'utf8')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(await runDalServiceRepositoryGuard({
      rootDir: directory,
      config: { ...config(), excludePatterns: ['ignored'] },
    })).toBe(0)
  })

  it('rejects missing, empty, and excluded-only scopes', async () => {
    const missing = await root()
    await expect(runDalServiceRepositoryGuard({ rootDir: missing, config: config() })).rejects.toThrow('missing directory')

    const empty = await root()
    await mkdir(path.join(empty, 'apps', 'api', 'src'), { recursive: true })
    await expect(runDalServiceRepositoryGuard({ rootDir: empty, config: config() })).rejects.toThrow('zero eligible files')

    const excluded = await root()
    await mkdir(path.join(excluded, 'apps', 'api', 'src'), { recursive: true })
    await writeFile(path.join(excluded, 'apps', 'api', 'src', 'setup.config.ts'), 'export {}', 'utf8')
    await expect(runDalServiceRepositoryGuard({ rootDir: excluded, config: config() })).rejects.toThrow('zero eligible files')
  })

  it('defends direct callers and reports malformed tsconfig files', async () => {
    const directory = await root()
    await expect(runDalServiceRepositoryGuard({
      rootDir: directory,
      config: { ...config(), sourceDirectory: '' },
    })).rejects.toThrow('requires sourceDirectory')
    await expect(runDalServiceRepositoryGuard({
      rootDir: directory,
      config: { ...config(), tsconfig: '' },
    })).rejects.toThrow('requires sourceDirectory')
    await expect(runDalServiceRepositoryGuard({
      rootDir: directory,
      config: { ...config(), layers: [] },
    })).rejects.toThrow('non-empty layers')

    const malformed = await root()
    await mkdir(path.join(malformed, 'apps', 'api', 'src'), { recursive: true })
    await writeFile(path.join(malformed, 'apps', 'api', 'src', 'index.ts'), 'export {}', 'utf8')
    await writeFile(path.join(malformed, 'apps', 'api', 'tsconfig.json'), '{', 'utf8')
    await expect(runDalServiceRepositoryGuard({
      rootDir: malformed,
      config: config(),
    })).rejects.toThrow('Failed to read backend tsconfig')

    await rm(path.join(malformed, 'apps', 'api', 'tsconfig.json'), { force: true })
    await mkdir(path.join(malformed, 'apps', 'api', 'tsconfig.json'))
    await expect(runDalServiceRepositoryGuard({
      rootDir: malformed,
      config: config(),
    })).rejects.toThrow('Failed to read backend tsconfig')
  })

  it('handles unresolved, external, unclassified, and allowed imports', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'controllers'), { recursive: true })
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'repositories'), { recursive: true })
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'utils'), { recursive: true })
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'utils', 'helper.ts'), 'export const helper = 1', 'utf8')
    await writeFile(path.join(directory, 'apps', 'api', 'external.ts'), 'export const external = 1', 'utf8')
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'controllers', 'clean.ts'), 'export const clean = 1', 'utf8')
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'controllers', 'user.ts'), [
      "import './missing.js'",
      'import { invalid } from 42',
      "import type ts from 'typescript'",
      "import { helper } from '../utils/helper.js'",
      "import { external } from '../../external.js'",
      "import { clean } from './clean.js'",
      'export { helper, external, clean }',
    ].join('\n'), 'utf8')
    await writeFile(
      path.join(directory, 'apps', 'api', 'src', 'repositories', 'repo.ts'),
      "import { helper } from '../utils/helper.js'\nexport { helper }",
      'utf8',
    )
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'ignored.txt'), 'ignored', 'utf8')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await runDalServiceRepositoryGuard({ rootDir: directory, config: config() })).toBe(0)
  })

  it('allows classified layers without an explicit forbidden dependency list', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'utilities'), { recursive: true })
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'repositories'), { recursive: true })
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'repositories', 'repo.ts'), 'export const repo = 1', 'utf8')
    await writeFile(
      path.join(directory, 'apps', 'api', 'src', 'utilities', 'utility.ts'),
      "import { repo } from '../repositories/repo.js'\nexport { repo }",
      'utf8',
    )
    const configured = config()
    configured.layers.push({ name: 'utility', paths: ['utilities'] })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(await runDalServiceRepositoryGuard({ rootDir: directory, config: configured })).toBe(0)
  })

  it('renders the warning color for partial compliance between 70 and 90 percent', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'controllers'), { recursive: true })
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'repositories'), { recursive: true })
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'repositories', 'repo.ts'), 'export const repo = 1', 'utf8')
    for (let index = 0; index < 4; index += 1) {
      await writeFile(
        path.join(directory, 'apps', 'api', 'src', 'controllers', `clean-${index}.ts`),
        'export {}',
        'utf8',
      )
    }
    await writeFile(
      path.join(directory, 'apps', 'api', 'src', 'controllers', 'violating.ts'),
      "import { repo } from '../repositories/repo.js'\nexport { repo }",
      'utf8',
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(await runDalServiceRepositoryGuard({ rootDir: directory, config: config() })).toBe(1)
    expect(log.mock.calls.flat().join('\n')).toContain('\x1b[33m83.3%')
  })

  it('handles a valid scope with no classified files', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'utils'), { recursive: true })
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'utils', 'helper.ts'), 'export {}', 'utf8')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(await runDalServiceRepositoryGuard({ rootDir: directory, config: config() })).toBe(0)
  })

  it('loads consumer policy when config is omitted and uses cwd when root is omitted', async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'controllers'), { recursive: true })
    await writeFile(path.join(directory, 'apps', 'api', 'src', 'controllers', 'clean.ts'), 'export {}', 'utf8')
    await mkdir(path.join(directory, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(directory, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: { dalServiceRepository: config() },
    }), 'utf8')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(runDalServiceRepositoryGuard({ rootDir: directory })).resolves.toBe(0)
    await expect(runDalServiceRepositoryGuard({
      config: { ...config(), sourceDirectory: 'missing' },
    })).rejects.toThrow('Failed to read backend tsconfig')
  })

  it('summarizes many violations deterministically', { timeout: 15_000 }, async () => {
    const directory = await root()
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'controllers'), { recursive: true })
    await mkdir(path.join(directory, 'apps', 'api', 'src', 'repositories'), { recursive: true })
    for (let dependency = 0; dependency < 6; dependency++) {
      await writeFile(
        path.join(directory, 'apps', 'api', 'src', 'repositories', `repo-${dependency}.ts`),
        `export const value${dependency} = ${dependency}`,
        'utf8',
      )
    }
    const imports = Array.from({ length: 6 }, (_, index) => (
      `import { value${index} } from '../repositories/repo-${index}.js'`
    )).join('\n')
    for (let file = 0; file < 21; file++) {
      await writeFile(
        path.join(directory, 'apps', 'api', 'src', 'controllers', `controller-${file}.ts`),
        `${imports}\nexport const controller${file} = true`,
        'utf8',
      )
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await runDalServiceRepositoryGuard({ rootDir: directory, config: config() })).toBe(1)
    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('more violation')
    expect(output).toContain('more file')
  })
})
