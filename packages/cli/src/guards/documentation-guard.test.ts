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
    files['docs/features/tests/sample-feature.md'] = '# Sample tests\n\n| Goal | File |\n|---|---|\n| Broken | `src/missing.test.ts` |\n\n## Later section\n'
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
      collections: [{
        files: ['docs/*.md'],
        pairedDocuments: {
          target: 'tests/{basename}',
          table: { header: ['Goal'], fileColumn: 'File' },
        },
      }],
    })).toThrow('must name a header column')
  })
})
