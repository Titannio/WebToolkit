import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TsconfigGuardConfig } from '../config.js'
import { runTsconfigGuard } from './tsconfig-guard.js'

const roots: string[] = []

async function fixture(config: object): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtoolkit-tsconfig-'))
  roots.push(root)
  await mkdir(path.join(root, 'apps', 'web'), { recursive: true })
  await mkdir(path.join(root, 'apps', 'web', 'src'), { recursive: true })
  await writeFile(path.join(root, 'apps', 'web', 'tsconfig.json'), JSON.stringify(config), 'utf8')
  await writeFile(path.join(root, 'apps', 'web', 'src', 'index.ts'), 'export {}', 'utf8')
  await writeFile(path.join(root, 'apps', 'web', 'Dockerfile'), 'FROM node:26', 'utf8')
  return root
}

function guardConfig(): TsconfigGuardConfig {
  return {
    packageScope: '@acme',
    configs: [{
      path: 'apps/web/tsconfig.json',
      requiredIncludes: ['src'],
      compilerOptions: { module: 'NodeNext' },
      publicAliases: ['@acme/core'],
    }],
    textFiles: [{
      path: 'apps/web/Dockerfile',
      forbiddenStrings: ['node:18'],
    }],
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('tsconfig guard', () => {
  it('accepts compliant configs and text files', async () => {
    const root = await fixture({
      include: ['src'],
      compilerOptions: {
        module: 'NodeNext',
        paths: { '@acme/core': ['../../packages/core'] },
      },
    })
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(await runTsconfigGuard({ rootDir: root, config: guardConfig() })).toBe(0)
  })

  it('resolves multi-level extends, inherited paths, normalized options, and relative base paths', async () => {
    const root = await fixture({
      extends: '../../configs/mid.json',
      include: ['src'],
      compilerOptions: {
        paths: { '@acme/core': ['../../packages/core'] },
      },
    })
    await mkdir(path.join(root, 'configs'), { recursive: true })
    await writeFile(path.join(root, 'configs', 'base.json'), JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
      },
    }), 'utf8')
    await writeFile(path.join(root, 'configs', 'mid.json'), JSON.stringify({
      extends: './base.json',
      compilerOptions: { strict: true },
    }), 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    expect(await runTsconfigGuard({
      rootDir: root,
      config: {
        configs: [{
          path: 'apps/web/tsconfig.json',
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
          },
          publicAliases: ['@acme/core'],
        }],
      },
    })).toBe(0)
  })

  it('evaluates overridden effective options while keeping requiredIncludes direct', async () => {
    const root = await fixture({
      extends: '../../configs/base.json',
      compilerOptions: { module: 'NodeNext' },
    })
    await mkdir(path.join(root, 'configs', 'src'), { recursive: true })
    await writeFile(path.join(root, 'configs', 'src', 'index.ts'), 'export {}', 'utf8')
    await writeFile(path.join(root, 'configs', 'base.json'), JSON.stringify({
      include: ['src'],
      compilerOptions: { module: 'CommonJS' },
    }), 'utf8')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await runTsconfigGuard({
      rootDir: root,
      config: {
        configs: [{
          path: 'apps/web/tsconfig.json',
          requiredIncludes: ['src'],
          compilerOptions: { module: 'NodeNext' },
        }],
      },
    })).toBe(1)
    expect(error.mock.calls.flat().join('\n')).toContain('include must contain')
    expect(error.mock.calls.flat().join('\n')).not.toContain('compilerOptions.module')
  })

  it('attributes include, option, alias, and forbidden-text violations', async () => {
    const root = await fixture({
      include: ['src'],
      compilerOptions: {
        module: 'CommonJS',
        paths: {
          '@acmebad': ['../../packages/bad'],
          '@acme/core': ['../../packages/core/src'],
        },
      },
    })
    await writeFile(path.join(root, 'apps', 'web', 'Dockerfile'), 'FROM node:18', 'utf8')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const invalidConfig = guardConfig()
    invalidConfig.configs[0].requiredIncludes = ['required']
    expect(await runTsconfigGuard({ rootDir: root, config: invalidConfig })).toBe(1)
    const output = error.mock.calls.flat().join('\n')
    expect(output).toContain('include must contain')
    expect(output).toContain('compilerOptions.module')
    expect(output).toContain('@acme/package-name')
    expect(output).toContain('src internals')
    expect(output).toContain('forbidden text')
  })

  it('rejects missing and malformed configured files', async () => {
    const root = await fixture({})
    await expect(runTsconfigGuard({
      rootDir: root,
      config: { configs: [] },
    })).rejects.toThrow('must not be empty')

    await expect(runTsconfigGuard({
      rootDir: root,
      config: { configs: [{ path: 'missing.json' }] },
    })).rejects.toThrow('Config file not found')

    await writeFile(path.join(root, 'apps', 'web', 'tsconfig.json'), '{', 'utf8')
    await expect(runTsconfigGuard({
      rootDir: root,
      config: { configs: [{ path: 'apps/web/tsconfig.json' }] },
    })).rejects.toThrow()

    await rm(path.join(root, 'apps', 'web', 'tsconfig.json'), { force: true })
    await mkdir(path.join(root, 'apps', 'web', 'tsconfig.json'))
    await expect(runTsconfigGuard({
      rootDir: root,
      config: { configs: [{ path: 'apps/web/tsconfig.json' }] },
    })).rejects.toThrow(/TS\d+/u)

    await rm(path.join(root, 'apps', 'web', 'tsconfig.json'), { recursive: true, force: true })
    await writeFile(path.join(root, 'apps', 'web', 'tsconfig.json'), '{}', 'utf8')
    await expect(runTsconfigGuard({
      rootDir: root,
      config: {
        configs: [{ path: 'apps/web/tsconfig.json' }],
        textFiles: [{ path: 'missing.txt', forbiddenStrings: ['bad'] }],
      },
    })).rejects.toThrow('Text file not found')
  })

  it('surfaces missing, circular, and invalid extends diagnostics', async () => {
    const missingRoot = await fixture({ extends: './missing.json' })
    await expect(runTsconfigGuard({
      rootDir: missingRoot,
      config: { configs: [{ path: 'apps/web/tsconfig.json' }] },
    })).rejects.toThrow(/TS\d+/u)

    const circularRoot = await fixture({ extends: './base.json' })
    await writeFile(
      path.join(circularRoot, 'apps', 'web', 'base.json'),
      JSON.stringify({ extends: './tsconfig.json' }),
      'utf8',
    )
    await expect(runTsconfigGuard({
      rootDir: circularRoot,
      config: { configs: [{ path: 'apps/web/tsconfig.json' }] },
    })).rejects.toThrow(/circularity/iu)

    const invalidRoot = await fixture({
      compilerOptions: { moduleResolution: 'invalid-value' },
    })
    await expect(runTsconfigGuard({
      rootDir: invalidRoot,
      config: { configs: [{ path: 'apps/web/tsconfig.json' }] },
    })).rejects.toThrow(/moduleResolution/u)
  })

  it('rejects invalid expected compiler options and treats missing aliases as empty', async () => {
    const root = await fixture({
      compilerOptions: { module: 'NodeNext' },
    })
    await expect(runTsconfigGuard({
      rootDir: root,
      config: {
        configs: [{
          path: 'apps/web/tsconfig.json',
          compilerOptions: { moduleResolution: 'invalid-value' },
          publicAliases: ['@acme/missing'],
        }],
      },
    })).rejects.toThrow(/moduleResolution/u)

    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await expect(runTsconfigGuard({
      rootDir: root,
      config: {
        configs: [{
          path: 'apps/web/tsconfig.json',
          publicAliases: ['@acme/missing'],
        }],
      },
    })).resolves.toBe(0)
  })

  it('loads consumer policy when config is omitted and uses cwd when root is omitted', async () => {
    const root = await fixture({ include: ['src'] })
    await mkdir(path.join(root, '.webtoolkit-cli'), { recursive: true })
    await writeFile(path.join(root, '.webtoolkit-cli', 'config.json'), JSON.stringify({
      guards: { tsconfig: { configs: [{ path: 'apps/web/tsconfig.json' }] } },
    }), 'utf8')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await expect(runTsconfigGuard({ rootDir: root })).resolves.toBe(0)
    await expect(runTsconfigGuard({
      config: { configs: [{ path: 'missing.json' }] },
    })).rejects.toThrow('Config file not found')
  })
})
