import { describe, expect, it } from 'vitest'

import { mergeConfig } from './config.js'
import { formatTaskStatusLine, listTaskCommands, normalizePassthroughArgs, resolveTaskName } from './tasks.js'

describe('task command routing', () => {
  it('maps public commands to configured task names', () => {
    expect(resolveTaskName('check')).toBe('check')
    expect(resolveTaskName('test-coverage')).toBe('testCoverage')
    expect(resolveTaskName('performance-bundle-audit')).toBe('performanceBundleAudit')
    expect(resolveTaskName('run:custom')).toBe('custom')
  })

  it('lists configured tasks in stable order', () => {
    const config = mergeConfig({
      tasks: {
        zeta: { steps: [] },
        alpha: { steps: [] },
      },
    })

    expect(listTaskCommands(config)).toEqual(['alpha', 'zeta'])
  })

  it('removes the CLI argument separator before passthrough', () => {
    expect(normalizePassthroughArgs(['--', '--filter', 'backend'])).toEqual(['--filter', 'backend'])
    expect(normalizePassthroughArgs(['--filter', 'backend'])).toEqual(['--filter', 'backend'])
  })

  it('formats a task status line with status and duration', () => {
    const line = formatTaskStatusLine({
      action: 'Building',
      label: 'Core',
      status: 'OK',
      durationMs: 1234,
    })

    expect(line).toContain('Building')
    expect(line).toContain('Core')
    expect(line).toContain('OK')
    expect(line).toContain('1.23s')
  })

  it('formats a task status line before completion', () => {
    expect(formatTaskStatusLine({ action: 'Running', label: 'Type-Check' })).toContain('...')
  })
})
