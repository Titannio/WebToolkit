#!/usr/bin/env tsx
// @ts-nocheck
/**
 * Schema Guard
 * 
 * Ensures complex Zod schemas are centralized in `@doutory/core`.
 * Flags schema definitions created outside the centralized directory in controllers,
 * services, or components.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Project, SyntaxKind } from 'ts-morph';

// Terminal colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// Centralized schema location
const CENTRAL_SCHEMA_DIR = 'packages/core/src/schemas';

// Directories to monitor
const WATCH_PATHS = [
  'apps/backend/src',
  'apps/frontend-admin/src',
  'apps/frontend-user/src',
];

// Exceptions (test files, mocks, infrastructure configs)
const EXCLUDE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /__tests__/,
    /backend-env\.schemas\.ts/, // Allowed for local env config files
    /frontend-env\.schemas\.ts/,
];

interface SchemaViolation {
  filePath: string;
  line: number;
  snippet: string;
}

function shouldSkipFile(filePath: string): boolean {
  if (filePath.includes(CENTRAL_SCHEMA_DIR.replace(/\//g, path.sep))) return true;
  if (!filePath.match(/\.(ts|tsx)$/)) return true;
  return EXCLUDE_PATTERNS.some(p => p.test(filePath));
}

function collectFiles(rootDir: string): string[] {
  const files: string[] = [];
  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && !shouldSkipFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }
  for (const p of WATCH_PATHS) {
    walkDir(path.resolve(rootDir, p));
  }
  return files;
}

async function run() {
  const rootDir = process.cwd();
  console.info(`${colors.bright}${colors.blue}🛡️  Checking Zod schema centralization...${colors.reset}`);

  const files = collectFiles(rootDir);
  const project = new Project();
  const violations: SchemaViolation[] = [];

  for (const filePath of files) {
    const sourceFile = project.addSourceFileAtPath(filePath);

    // Look for z.object, z.enum, z.array calls, etc.
    // Ignore z.infer (type-only usage).
    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const text = call.getText();
      if (text.startsWith('z.object') || text.startsWith('z.enum') || text.startsWith('z.array') || text.startsWith('z.nativeEnum')) {
        // Ensure this is a schema definition (usually assigned to a variable)
        const parent = call.getParent();
        if (parent?.getKind() === SyntaxKind.VariableDeclaration || parent?.getKind() === SyntaxKind.PropertyAssignment) {
          violations.push({
            filePath: path.relative(rootDir, filePath),
            line: call.getStartLineNumber(),
            snippet: text.split('\n')[0].substring(0, 50) + '...',
          });
        }
      }
    });
  }

  if (violations.length === 0) {
    console.info(`${colors.green}${colors.bright}✅ [OK]${colors.reset} Todos os schemas parecem estar centralizados!`);
    process.exit(0);
  }

    console.info(`${colors.bright}${colors.yellow}⚠️  FOUND ZOD SCHEMAS OUTSIDE CORE${colors.reset}`);
  console.info(`${colors.gray}Policy: Centralize Zod schemas in @doutory/core (packages/core/src/schemas/)${colors.reset}\n`);

  for (const v of violations) {
    console.info(`${colors.gray}${v.filePath}:${v.line}${colors.reset}`);
    console.info(`   ${colors.red}→${colors.reset} ${v.snippet}\n`);
  }

  console.info(`${colors.bright}${colors.red}⚠️  IMPORTANT: Move these definitions to @doutory/core.${colors.reset}`);
  console.info(`${colors.red}Centralizing Zod schemas is a required architectural rule for the project.${colors.reset}\n`);

  process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
