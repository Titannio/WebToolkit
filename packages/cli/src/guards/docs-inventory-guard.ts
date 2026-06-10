#!/usr/bin/env tsx
// @ts-nocheck
/**
 * Docs Inventory Guard
 *
 * Validates backtick file entries in docs README inventories, such as:
 * - `todo.md`: Open planning items.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT_DIR = process.cwd()
const DOCS_DIR = path.resolve(ROOT_DIR, 'docs')

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
}

type InventoryViolation = {
  filePath: string
  line: number
  entry: string
  targetPath: string
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function toRelativeFilePath(filePath: string): string {
  return normalizeFilePath(path.relative(ROOT_DIR, filePath))
}

function collectReadmes(dir: string): string[] {
  const files: string[] = []

  if (!fs.existsSync(dir)) {
    return files
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectReadmes(fullPath))
      continue
    }

    if (entry.isFile() && entry.name.toLowerCase() === 'readme.md') {
      files.push(fullPath)
    }
  }

  return files.sort((left, right) => left.localeCompare(right))
}

function collectInventoryViolations(readmePath: string): InventoryViolation[] {
  const readmeDir = path.dirname(readmePath)
  const lines = fs.readFileSync(readmePath, 'utf8').split(/\r?\n/)
  const violations: InventoryViolation[] = []

  lines.forEach((line, index) => {
    const match = line.match(/^\s*-\s+`([^`]+\.(?:md|mdx|png|jpg|jpeg|webp|svg|json|yaml|yml))`:/i)
    if (!match) return

    const entry = match[1]
    const targetPath = path.resolve(readmeDir, entry)

    if (!fs.existsSync(targetPath)) {
      violations.push({
        filePath: toRelativeFilePath(readmePath),
        line: index + 1,
        entry,
        targetPath: toRelativeFilePath(targetPath),
      })
    }
  })

  return violations
}

function main(): void {
  console.info(`${colors.bright}${colors.blue}Checking docs README inventories...${colors.reset}`)

  const violations = collectReadmes(DOCS_DIR).flatMap(collectInventoryViolations)

  if (violations.length === 0) {
    console.info(`${colors.green}${colors.bright}OK${colors.reset} Docs README inventories reference existing files.`)
    process.exit(0)
  }

  console.info(`${colors.bright}${colors.red}Docs inventory violations found${colors.reset}`)
  console.info(`${colors.gray}Backtick file entries in docs README files must point to files that exist.${colors.reset}\n`)

  for (const violation of violations) {
    console.info(`${colors.gray}${violation.filePath}:${violation.line}${colors.reset}`)
    console.info(`  ${colors.red}->${colors.reset} Missing inventory target \`${violation.entry}\``)
    console.info(`  ${colors.gray}${violation.targetPath}${colors.reset}`)
  }

  process.exit(1)
}

main()
