import { describe, expect, it } from 'vitest'

import { formatFailureSummary, formatWorkspaceTestStatusLine } from './workspace-tests.js'

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

describe('workspace test output formatting', () => {
  it('formats successful workspace test output concisely', () => {
    expect(stripAnsi(formatWorkspaceTestStatusLine({ failed: false, duration: '179.3' }))).toBe('OK (179.3s)')
  })

  it('formats failed workspace test output with failure and file counts', () => {
    const line = formatWorkspaceTestStatusLine({
      failed: true,
      duration: '123.4',
      summary: {
        failedFiles: 7,
        failedTests: 9,
        failedTestsDetected: true,
      },
    })

    expect(stripAnsi(line)).toBe('ERRO - 9 falhas em 7 arquivos (123.4s)')
  })

  it('formats singular and plural failure summaries', () => {
    expect(formatFailureSummary({ failedFiles: 1, failedTests: 1, failedTestsDetected: true })).toBe('1 falha em 1 arquivo')
    expect(formatFailureSummary({ failedFiles: 2, failedTests: 1, failedTestsDetected: true })).toBe('1 falha em 2 arquivos')
    expect(formatFailureSummary({ failedFiles: 1, failedTests: 3, failedTestsDetected: true })).toBe('3 falhas em 1 arquivo')
  })

  it('keeps undetected test counts explicit', () => {
    expect(formatFailureSummary({ failedFiles: 1, failedTests: 0, failedTestsDetected: false })).toBe('falhas nao detectadas em 1 arquivo')
  })
})
