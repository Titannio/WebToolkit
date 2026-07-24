import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { TsconfigGuardConfig } from '../config.js'
import { isMainModule, loadGuardConfig, resolveProjectPath } from './guard-config.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
}

type LoadedTsConfig = {
  raw: Record<string, unknown>
  parsed: ts.ParsedCommandLine
  absolutePath: string
}

function formatDiagnostics(relativePath: string, diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics.map((diagnostic) => (
    `${relativePath}: TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
  )).join('\n')
}

function readConfig(rootDir: string, relativePath: string): LoadedTsConfig {
  const absolutePath = resolveProjectPath(rootDir, relativePath)
  if (!fs.existsSync(absolutePath)) throw new Error(`Config file not found: ${relativePath}`)
  const result = ts.readConfigFile(absolutePath, ts.sys.readFile)
  if (result.error) {
    throw new Error(formatDiagnostics(relativePath, [result.error]))
  }
  const parsed = ts.parseJsonConfigFileContent(
    result.config,
    ts.sys,
    path.dirname(absolutePath),
    undefined,
    absolutePath,
  )
  if (parsed.errors.length > 0) {
    throw new Error(formatDiagnostics(relativePath, parsed.errors))
  }
  return {
    raw: result.config as Record<string, unknown>,
    parsed,
    absolutePath,
  }
}

function pointsToSourceInternals(values: string[]): boolean {
  return values.some((value) => /(^|[/\\])src([/\\]|$)/u.test(value))
}

export async function runTsconfigGuard(options: {
  rootDir?: string
  config?: TsconfigGuardConfig
} = {}): Promise<number> {
  const rootDir = options.rootDir ?? process.cwd()
  const config = options.config ?? await loadGuardConfig('tsconfig', rootDir)
  /* v8 ignore next -- both outcomes are asserted; V8 omits the fallthrough branch */
  if (config.configs.length === 0) {
    throw new Error('guards.tsconfig.configs must not be empty.')
  }

  const errors: string[] = []
  for (const check of config.configs) {
    const loaded = readConfig(rootDir, check.path)
    const rawInclude = Array.isArray(loaded.raw.include) ? loaded.raw.include : []
    const aliases = loaded.parsed.options.paths ?? {}

    for (const requiredInclude of check.requiredIncludes ?? []) {
      if (!rawInclude.includes(requiredInclude)) {
        errors.push(`${check.path}: include must contain "${requiredInclude}".`)
      }
    }

    const expectedOptions = check.compilerOptions ?? {}
    const converted = ts.convertCompilerOptionsFromJson(
      expectedOptions,
      path.dirname(loaded.absolutePath),
      check.path,
    )
    if (converted.errors.length > 0) {
      throw new Error(formatDiagnostics(check.path, converted.errors))
    }
    for (const [option, expected] of Object.entries(expectedOptions)) {
      const actual = (loaded.parsed.options as Record<string, unknown>)[option]
      const normalizedExpected = (converted.options as Record<string, unknown>)[option]
      if (actual !== normalizedExpected) {
        errors.push(`${check.path}: compilerOptions.${option} must equal ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}.`)
      }
    }

    if (config.packageScope) {
      for (const alias of Object.keys(aliases)) {
        if (alias.startsWith(config.packageScope) && alias !== config.packageScope && !alias.startsWith(`${config.packageScope}/`)) {
          errors.push(`${check.path}: alias "${alias}" must use the "${config.packageScope}/package-name" convention.`)
        }
      }
    }

    for (const alias of check.publicAliases ?? []) {
      const targets = aliases[alias] ?? []
      if (pointsToSourceInternals(targets)) {
        errors.push(`${check.path}: public alias "${alias}" cannot point to package src internals.`)
      }
    }
  }

  for (const check of config.textFiles ?? []) {
    const absolutePath = resolveProjectPath(rootDir, check.path)
    if (!fs.existsSync(absolutePath)) throw new Error(`Text file not found: ${check.path}`)
    const content = fs.readFileSync(absolutePath, 'utf8')
    for (const forbidden of check.forbiddenStrings) {
      if (content.includes(forbidden)) errors.push(`${check.path}: contains forbidden text "${forbidden}".`)
    }
  }

  if (errors.length > 0) {
    console.error('\nTSConfig guard failed:')
    for (const error of errors) console.error(`  - ${error}`)
    return 1
  }

  console.info(`✅${colors.green}${colors.bright} [OK]${colors.reset} TSConfig guard in compliance`)
  return 0
}

/* v8 ignore start -- executable adapter */
if (isMainModule(import.meta.url)) {
  runTsconfigGuard().then((code) => {
    process.exitCode = code
  }).catch((error: unknown) => {
    console.error((error as Error).message)
    process.exitCode = 1
  })
}
/* v8 ignore stop */
