import { describe, expect, it, vi } from 'vitest'

import { configSchema, configSectionNames, formatConfigHelp, getConfigSchema, runConfigReference } from './config-reference.js'

describe('config reference', () => {
  it('exposes every public config section', () => {
    expect(configSectionNames()).toEqual([
      'packageManager',
      'cleaner',
      'tasks',
      'documentation',
      'workspaceTests',
      'repoCheck',
      'releaseGate',
      'validate',
      'jsdocReport',
      'bundleAudit',
      'upgrade',
      'devWatch',
      'devGrid',
      'environment',
    ])
    expect(getConfigSchema()).toBe(configSchema)
  })

  it('renders general and section-specific human help', () => {
    expect(formatConfigHelp()).toContain('webtoolkit config --help <section>')
    expect(formatConfigHelp()).toContain('documentation')

    const help = formatConfigHelp('documentation')
    expect(help).toContain('files (array; required)')
    expect(help).toContain('Machine-readable schema: webtoolkit config --json documentation')
    expect(help).toContain('docs/**/*.md')

    expect(formatConfigHelp('environment')).not.toContain('Example:')
    expect(formatConfigHelp('packageManager')).toContain('Fields:')
    expect(formatConfigHelp('devWatch')).toContain('default="127.0.0.1"')
    expect(formatConfigHelp('upgrade')).toContain('singletonGuardCommand (object; optional)')
  })

  it('returns filtered JSON Schema and rejects unknown sections', () => {
    const schema = getConfigSchema('documentation')
    expect(schema).toMatchObject({
      type: 'object',
      properties: { documentation: { $ref: '#/$defs/documentation' } },
    })
    expect(() => getConfigSchema('missing')).toThrow('Available sections')
    expect(() => formatConfigHelp('missing')).toThrow('Available sections')
  })

  it('prints human or JSON output and validates arguments', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    runConfigReference([])
    expect(info).toHaveBeenLastCalledWith(expect.stringContaining('Configuration file'))

    runConfigReference(['--help', 'documentation'])
    expect(info).toHaveBeenLastCalledWith(expect.stringContaining('files (array; required)'))

    runConfigReference(['--json', 'documentation'])
    expect(() => JSON.parse(String(info.mock.calls.at(-1)?.[0]))).not.toThrow()

    expect(() => runConfigReference(['--unknown'])).toThrow('Usage:')
    expect(() => runConfigReference(['documentation', 'cleaner'])).toThrow('Usage:')
  })
})
