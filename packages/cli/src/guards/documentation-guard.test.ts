import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { DocumentationConfig } from '../config.js'
import { checkDocumentation, validateDocumentationConfig } from './documentation-guard.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function corpus(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'webtoolkit-docs-'))
  roots.push(root)
  for (const [relativePath, content] of Object.entries(files)) {
    const file = join(root, relativePath)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return root
}

const featureMetadata = [
  '> **Identifier:** `sample-feature`  ',
  '> **Status:** `IMPLEMENTED`  ',
  '> **Domain:** example  ',
  '> **Sources:** `src/example.ts`  ',
  '> **Tests:** [test matrix](./tests/sample-feature.md)',
].join('\n')

function validFiles(): Record<string, string> {
  return {
    'README.md': '# Project\n\n[Docs](docs/README.md)\n',
    'docs/README.md': '# Docs\n\n[Features](features/README.md)\n',
    'docs/features/README.md': '# Features\n\n[Sample](sample-feature.md)\n\n[Mapping](mapping/README.md)\n',
    'docs/features/sample-feature.md': `# Sample\n\n${featureMetadata}\n`,
    'docs/features/tests/README.md': '# Test matrices\n\n[Sample](sample-feature.md)\n',
    'docs/features/tests/sample-feature.md': [
      '# Sample tests',
      '',
      '[Feature](../sample-feature.md)',
      '',
      '## Implemented tests',
      '',
      '| Goal | File |',
      '|---|---|',
      '| Main behavior | `src/example.test.ts` and `src/second.test.ts` |',
      '',
      '## Possible tests',
      '',
      '- Browser flow.',
      '',
    ].join('\n'),
    'docs/features/mapping/README.md': '# Mapping\n\n[Contracts](contracts.md)\n\n[Frontends](frontends.md)\n\n[Data](data.md)\n',
    'docs/features/mapping/contracts.md': '# Contracts\n\n`packages/core/src/sample.contract.ts`\n',
    'docs/features/mapping/frontends.md': '# Frontends\n\n`apps/frontend/src/App.tsx`\n',
    'docs/features/mapping/data.md': '# Data\n',
    'src/example.ts': 'export const example = true\n',
    'src/example.test.ts': 'export const tested = true\n',
    'src/second.test.ts': 'export const testedAgain = true\n',
    'packages/core/src/sample.contract.ts': 'export const contract = {}\n',
    'apps/frontend/src/App.tsx': 'export const App = () => null\n',
    '.corepack/cache/README.md': 'invalid ignored document\n',
  }
}

const config: DocumentationConfig = {
  files: ['docs/**/*.md', '**/README.md'],
  checks: {
    reachability: { entrypoints: ['**/README.md'], files: ['docs/**/*.md'] },
  },
  requiredFiles: [
    'docs/features/mapping/README.md',
    'docs/features/mapping/contracts.md',
    'docs/features/mapping/frontends.md',
    'docs/features/mapping/data.md',
  ],
  collections: [{
    files: ['docs/features/*.md'],
    exclude: ['docs/features/README.md'],
    index: 'docs/features/README.md',
    metadata: {
      Identifier: { equals: '{stem}', unique: true },
      Status: { equals: 'IMPLEMENTED' },
      Domain: {},
      Sources: { repositoryPaths: true },
      Tests: {},
    },
    pairedDocuments: {
      target: 'docs/features/tests/{basename}',
      index: 'docs/features/tests/README.md',
      table: { header: ['Goal', 'File'], fileColumn: 'File', minRows: 1 },
      finalSection: { heading: 'Possible tests', minItems: 1 },
    },
  }],
  inventories: [
    { document: 'docs/features/mapping/contracts.md', sources: ['packages/core/src/*.contract.ts'], minMatches: 1 },
    { document: 'docs/features/mapping/frontends.md', sources: ['apps/frontend/src/App.tsx'] },
  ],
}

describe('documentation guard', () => {
  it('accepts a complete configured documentation corpus', () => {
    expect(checkDocumentation(corpus(validFiles()), config)).toEqual([])
  })

  it('reports generic Markdown and reachability failures', () => {
    const files = validFiles()
    files['README.md'] = '# Project\n\n[Missing](missing.md)\n'
    files['docs/orphan.md'] = '# Orphan\n\n### Jump\n'

    const errors = checkDocumentation(corpus(files), config)
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('broken or unsafe local link'),
      expect.stringContaining('document is unreachable'),
      expect.stringContaining('heading jumps'),
    ]))
  })

  it('reports collection metadata, index, and paired-document failures', () => {
    const files = validFiles()
    files['docs/features/README.md'] = '# Features\n\n[Mapping](mapping/README.md)\n'
    files['docs/features/sample-feature.md'] = '# Sample\n\n> **Identifier:** `wrong`  \n> **Status:** `PLANNED`  \n> **Sources:** `src/missing.ts`  \n'
    delete files['docs/features/tests/sample-feature.md']

    const errors = checkDocumentation(corpus(files), config)
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('Identifier must equal sample-feature'),
      expect.stringContaining('missing required metadata: Domain'),
      expect.stringContaining('missing repository path in Sources'),
      expect.stringContaining('expected exactly one link in docs/features/README.md'),
      expect.stringContaining('paired document is missing'),
    ]))
  })

  it('reports invalid paired content, missing required files, and incomplete inventories', () => {
    const files = validFiles()
    files['docs/features/tests/sample-feature.md'] = '# Sample tests\n\n| Goal | File |\n|---|---|\n| Broken | `src/missing.test.ts` |\n| Missing |\n\n## Later section\n'
    files['docs/features/mapping/contracts.md'] = '# Contracts\n'
    delete files['docs/features/mapping/data.md']

    const errors = checkDocumentation(corpus(files), config)
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid or missing file reference'),
      expect.stringContaining('missing final section'),
      expect.stringContaining('required documentation file is missing'),
      expect.stringContaining('source is not inventoried'),
    ]))
  })

  it('rejects malformed or unsafe configuration', () => {
    expect(() => validateDocumentationConfig({ files: [] })).toThrow('non-empty')
    expect(() => validateDocumentationConfig({ files: ['../docs/*.md'] })).toThrow('inside the repository')
    expect(() => validateDocumentationConfig({
      files: ['docs/*.md'],
      excludeDirectories: 42,
    } as never)).toThrow('an array of strings')
    expect(() => validateDocumentationConfig({
      files: ['docs/*.md'],
      collections: [{
        files: ['docs/*.md'],
        pairedDocuments: {
          target: 'tests/{basename}',
          table: { header: ['Goal'], fileColumn: 'File' },
        },
      }],
    })).toThrow('must name a header column')
  })

  it('rejects malformed nested collection and inventory shapes for direct callers', () => {
    expect(() => validateDocumentationConfig({
      files: ['docs/*.md'],
      collections: 'invalid',
    } as never)).toThrow('collections must be an array')
    expect(() => validateDocumentationConfig({
      files: ['docs/*.md'],
      collections: [{ files: ['docs/*.md'], metadata: [] }],
    } as never)).toThrow('metadata must be an object')
    expect(() => validateDocumentationConfig({
      files: ['docs/*.md'],
      collections: [{ files: ['docs/*.md'], pairedDocuments: { target: '' } }],
    } as never)).toThrow('target must be a string')
    expect(() => validateDocumentationConfig({
      files: ['docs/*.md'],
      inventories: 'invalid',
    } as never)).toThrow('inventories must be an array')
    expect(() => validateDocumentationConfig({
      files: ['docs/*.md'],
      inventories: [{ document: '', sources: [] }],
    })).toThrow('document must be a string')
  })

  it('covers fenced Markdown, cardinality rules, duplicate metadata, and orphan pairs', () => {
    const files = validFiles()
    files['README.md'] = [
      '# Project',
      '',
      '[Anchor](#section) [External](https://example.com) [Empty]()',
      '',
      '```md',
      '### Ignored heading',
      '[Ignored missing](missing.md)',
      '```',
      '',
      '[Docs](docs/README.md)',
    ].join('\n')
    files['docs/features/second-feature.md'] = `# Second\n\n${featureMetadata}\n`
    files['docs/features/tests/orphan.md'] = '# Orphan pair\n'
    files['docs/features/tests/sample-feature.md'] = [
      '# Sample tests',
      '',
      '[Feature](../sample-feature.md)',
      '',
      '| Wrong | Header |',
      '|---|---|',
      '',
      '## Possible tests',
      '',
      '## Not final',
    ].join('\n')
    delete files['docs/features/tests/README.md']
    delete files['docs/features/mapping/contracts.md']

    const errors = checkDocumentation(corpus(files), {
      ...config,
      inventories: [
        { document: 'docs/features/mapping/contracts.md', sources: ['packages/core/src/*.contract.ts'], minMatches: 2 },
        { document: 'docs/features/mapping/frontends.md', sources: ['missing/**/*.ts'], minMatches: 1 },
      ],
    })
    expect(errors.join('\n')).toContain('duplicate Identifier')
    expect(errors.join('\n')).toContain('expected exactly one link in docs/features/README.md')
    expect(errors.join('\n')).toContain('missing table header')
    expect(errors.join('\n')).toContain('must be the final H2')
    expect(errors.join('\n')).toContain('paired document has no source')
    expect(errors.join('\n')).toContain('inventory document is missing')
    expect(errors.join('\n')).toContain('inventory requires at least')
  })

  it('reports H1, table-row, final-section-item, and metadata reference minimums', () => {
    const files = validFiles()
    files['docs/features/sample-feature.md'] = `${featureMetadata.replace('`src/example.ts`', '')}\n`
    files['docs/features/tests/sample-feature.md'] = [
      '# One',
      '# Two',
      '',
      '[Feature](../sample-feature.md)',
      '',
      '| Goal | File |',
      '|---|---|',
      '',
      '## Possible tests',
    ].join('\n')
    const errors = checkDocumentation(corpus(files), config)
    expect(errors.join('\n')).toContain('expected exactly one H1')
    expect(errors.join('\n')).toContain('table requires at least')
    expect(errors.join('\n')).toContain('final section requires at least')
    expect(errors.join('\n')).toContain('Sources requires at least')
  })

  it('honors disabled generic checks and optional top-level sections', () => {
    const root = corpus({
      'docs/invalid.md': '### Jump\n\n[Missing](missing.md)\n',
      'ignored/invalid.md': 'also ignored',
    })
    expect(checkDocumentation(root, {
      files: ['docs/*.md'],
      excludeDirectories: ['ignored'],
      checks: {
        singleH1: false,
        headingOrder: false,
        localLinks: false,
      },
    })).toEqual([])
  })

  it('covers optional collection and pair policies with default cardinalities', () => {
    const root = corpus({
      'docs/source.md': '# Source\n\n[Pair](pairs/source.md)\n',
      'docs/simple.md': '# Simple\n\n[Pair](pairs/simple.md)\n',
      'docs/plain.md': '# Plain\n',
      'docs/pairs/source.md': [
        '# Pair',
        '',
        '| Goal | File |',
        '|---|---|',
        '',
        '## Possible tests',
      ].join('\n'),
      'docs/inventory.md': '# Inventory\n',
      'docs/pairs/simple.md': '# Simple pair\n',
    })
    const errors = checkDocumentation(root, {
      files: ['docs/*.md'],
      collections: [
        { files: ['docs/plain.md'] },
        {
          files: ['docs/source.md'],
          index: 'docs/missing-index.md',
          pairedDocuments: {
            target: 'docs/pairs/{basename}',
            table: { header: ['Goal', 'File'], fileColumn: 'File' },
            finalSection: { heading: 'Possible tests' },
          },
        },
        {
          files: ['docs/simple.md'],
          pairedDocuments: { target: 'docs/pairs/{basename}' },
        },
      ],
      inventories: [{ document: 'docs/inventory.md', sources: ['missing/*.ts'] }],
    })

    expect(errors.join('\n')).toContain('collection index is missing')
    expect(errors.join('\n')).toContain('table requires at least 1')
    expect(errors.join('\n')).toContain('final section requires at least 1')
  })

  it('resolves root-relative, directory, query-only, and malformed encoded links', () => {
    const root = corpus({
      'README.md': [
        '# Root',
        '',
        '[Directory](docs/)',
        '[Absolute](/docs/README.md)',
        '[Query](?)',
        '[Malformed](%FF)',
      ].join('\n'),
      'docs/README.md': '# Docs\n',
    })
    const errors = checkDocumentation(root, {
      files: ['README.md', 'docs/*.md'],
      checks: {
        reachability: {
          entrypoints: ['README.md'],
          files: ['docs/*.md'],
        },
      },
    })
    expect(errors.join('\n')).toContain('broken or unsafe local link: %FF')
    expect(errors.join('\n')).not.toContain('docs/')
    expect(errors.join('\n')).not.toContain('/docs/README.md')
  })
})
