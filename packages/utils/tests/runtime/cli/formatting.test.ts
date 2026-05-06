import { describe, expect, it } from 'vitest'
import { buildAsciiTable, padAnsi, stripAnsi } from '@src/runtime/cli/formatting.js'

describe('cli utils', () => {
  it('should strip ansi escape sequences', () => {
    expect(stripAnsi('\x1b[32mOK\x1b[0m')).toBe('OK')
  })

  it('should pad using visible length', () => {
    expect(padAnsi('\x1b[32mOK\x1b[0m', 4)).toBe('\x1b[32mOK\x1b[0m  ')
  })

  it('should build an ascii table', () => {
    const table = buildAsciiTable(
      [
        { name: 'Short', status: '\x1b[32mOK\x1b[0m' },
        { name: 'Longer', status: 'FAIL' },
      ],
      [
        { header: 'Name', getValue: (row) => row.name },
        { header: 'Status', getValue: (row) => row.status },
      ]
    )

    expect(stripAnsi(table)).toContain('| Name   | Status |')
    expect(stripAnsi(table)).toContain('| Longer | FAIL   |')
  })
})
