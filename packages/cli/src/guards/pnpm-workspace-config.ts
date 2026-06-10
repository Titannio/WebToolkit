// @ts-nocheck
import fs from 'node:fs'
import path from 'node:path'

export const PNPM_WORKSPACE_CONFIG_PATH = path.resolve(process.cwd(), 'pnpm-workspace.yaml')

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim()

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

export function readPnpmWorkspaceOverrides(filePath = PNPM_WORKSPACE_CONFIG_PATH): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  const overrides: Record<string, string> = {}
  let insideOverrides = false

  for (const line of lines) {
    if (!insideOverrides) {
      if (/^overrides:\s*$/.test(line)) {
        insideOverrides = true
      }
      continue
    }

    if (/^\S/.test(line)) {
      break
    }

    const match = line.match(/^\s{2}([^:#][^:]*):\s*(.*?)\s*$/)
    if (!match) continue

    const packageName = unquoteYamlScalar(match[1])
    const version = unquoteYamlScalar(match[2])
    if (packageName && version) {
      overrides[packageName] = version
    }
  }

  return overrides
}
