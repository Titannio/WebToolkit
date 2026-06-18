import { afterEach, describe, expect, it, vi } from 'vitest'

import { runValidateEngine } from './validate.js'
import { mergeConfig } from './config.js'

vi.mock('./process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./process.js')>()
  return {
    ...actual,
    runCommandBuffered: vi.fn(),
  }
})

vi.mock('./guard-runner.js', () => ({
  executeBuiltinGuard: vi.fn(),
}))

import { runCommandBuffered } from './process.js'
import { executeBuiltinGuard } from './guard-runner.js'

const runtimeWithConfig = (cwd: string, config: Parameters<typeof mergeConfig>[0]) => ({ cwd, config: mergeConfig(config) })

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(runCommandBuffered).mockReset()
  vi.mocked(executeBuiltinGuard).mockReset()
})

describe('validate', () => {
  it('executes all steps and optional post-steps when successful', async () => {
    vi.mocked(runCommandBuffered).mockResolvedValue({ code: 0, output: 'ok' })

    await runValidateEngine(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      validate: {
        steps: [
          { label: 'lint', command: 'pnpm', args: ['lint'] },
        ],
        postSteps: [
          { label: 'post', command: 'pnpm', args: ['post'] },
        ],
      },
    }))

    expect(vi.mocked(runCommandBuffered)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(runCommandBuffered)).toHaveBeenNthCalledWith(1, {
      command: 'pnpm',
      args: ['lint'],
      cwd: undefined,
      env: undefined,
    }, '/repo')
  })

  it('throws when a step command exits with non-zero code', async () => {
    vi.mocked(runCommandBuffered).mockResolvedValueOnce({ code: 1, output: 'failed' })

    await expect(runValidateEngine(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      validate: {
        steps: [{ label: 'lint', command: 'pnpm', args: ['lint'] }],
      },
    }))).rejects.toThrow('Validate step "lint" failed.')

    expect(vi.mocked(runCommandBuffered)).toHaveBeenCalledTimes(1)
  })

  it('accepts steps with explicit args and empty output on success', async () => {
    vi.mocked(runCommandBuffered).mockResolvedValue({ code: 0, output: '' })

    await runValidateEngine(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      validate: {
        steps: [{ label: 'lint', command: 'pnpm', args: ['lint'] }],
      },
    }))

    expect(vi.mocked(runCommandBuffered)).toHaveBeenCalledWith({
      command: 'pnpm',
      args: ['lint'],
      cwd: undefined,
      env: undefined,
    }, '/repo')
  })

  it('falls back to command text when a failing step has no output', async () => {
    vi.mocked(runCommandBuffered).mockResolvedValueOnce({ code: 1, output: '' })

    await expect(runValidateEngine(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      validate: {
        steps: [{ label: 'lint', command: 'pnpm', args: ['lint'] }],
      },
    }))).rejects.toThrow('Validate step "lint" failed.')
  })

  it('passes no args when step command has no args', async () => {
    vi.mocked(runCommandBuffered).mockResolvedValue({ code: 0, output: '' })

    await runValidateEngine(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      validate: {
        steps: [{ label: 'lint', command: 'pnpm' }],
      },
    }))

    expect(vi.mocked(runCommandBuffered)).toHaveBeenCalledWith({
      command: 'pnpm',
      args: [],
      cwd: undefined,
      env: undefined,
    }, '/repo')
  })

  it('shows fallback command text when failing without output', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.mocked(runCommandBuffered).mockResolvedValueOnce({ code: 1, output: '' })

    await expect(runValidateEngine(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      validate: {
        steps: [{ label: 'lint', command: 'pnpm', args: ['lint'] }],
      },
    }))).rejects.toThrow('Validate step "lint" failed.')

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Command failed: pnpm lint'))
    consoleInfo.mockRestore()
  })

  it('falls back to command text when failing without args and without output', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.mocked(runCommandBuffered).mockResolvedValueOnce({ code: 1, output: '' })

    await expect(runValidateEngine(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      validate: {
        steps: [{ label: 'lint', command: 'pnpm' }],
      },
    }))).rejects.toThrow('Validate step "lint" failed.')

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Command failed: pnpm'))
    consoleInfo.mockRestore()
  })

  it('rejects configs without steps', async () => {
    await expect(runValidateEngine(runtimeWithConfig('/repo', { packageManager: 'pnpm' }))).rejects.toThrow('validate.steps is not configured.')
  })

  it('rejects validate step without command', async () => {
    await expect(runValidateEngine(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      validate: {
        steps: [{ label: 'broken' }],
      },
    }))).rejects.toThrow('Validate step "broken" must define command or builtinGuard.')
  })

  it('executes builtin guard steps without spawning configured commands', async () => {
    vi.mocked(executeBuiltinGuard).mockReturnValue(0)

    await runValidateEngine(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      validate: {
        steps: [{ label: 'guard', builtinGuard: 'docs-inventory', args: ['--strict'] }],
      },
    }))

    expect(executeBuiltinGuard).toHaveBeenCalledWith('docs-inventory', ['--strict'], '/repo')
    expect(vi.mocked(runCommandBuffered)).not.toHaveBeenCalled()
  })

  it('reports builtin guard failures with a command-like fallback', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.mocked(executeBuiltinGuard).mockReturnValue(1)

    await expect(runValidateEngine(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      validate: {
        steps: [{ label: 'guard', builtinGuard: 'code-pattern', args: ['--changed'] }],
      },
    }))).rejects.toThrow('Validate step "guard" failed.')

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Command failed: webtoolkit guard code-pattern --changed'))
    consoleInfo.mockRestore()
  })

  it('reports builtin guard failures without optional args', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.mocked(executeBuiltinGuard).mockReturnValue(1)

    await expect(runValidateEngine(runtimeWithConfig('/repo', {
      packageManager: 'pnpm',
      validate: {
        steps: [{ label: 'guard', builtinGuard: 'code-pattern' }],
      },
    }))).rejects.toThrow('Validate step "guard" failed.')

    expect(executeBuiltinGuard).toHaveBeenCalledWith('code-pattern', [], '/repo')
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('Command failed: webtoolkit guard code-pattern'))
    consoleInfo.mockRestore()
  })
})
