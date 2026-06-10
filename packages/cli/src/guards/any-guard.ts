#!/usr/bin/env tsx
// @ts-nocheck
/**
 * Any Guard
 * 
 * Scans the codebase for forbidden `any` usage and fails when it finds
 * occurrences outside test files or explicit `@anyAllowed` overrides.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Project, SyntaxKind, Node } from 'ts-morph';

// Resolve this script directory so it can exclude itself from the scan.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  white: '\x1b[37m',
};

// Directories to include.
const INCLUDE_PATHS = [
  'apps',
  'packages',
  'scripts',
];

// Exclusion patterns (always ignore build artifacts, dependencies, and metadata files).
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /dist/,
  /build/,
  /coverage/,
  /\.test\./,
  /\.spec\./,
  /tests\//,
  /__tests__\//,
  /LICENSE/i,
  /README/i,
  /\.md$/,
  /\.txt$/,
  /\.json$/,
  /\.lock$/,
  /\.yaml$/,
  /\.yml$/,
];

// Comprehensive regex to capture `any` in multiple TypeScript contexts:
// 1. : any (direct typing)
// 2. as any (type assertion)
// 3. <any> (legacy assertion syntax)
// 4. any[] (arrays)
// 5. [<, ] any (generics like Array<any>, Record<string, any>)
// 6. extends any (inheritance constraints)
// 7. any() (type/function calls)
const ANY_REGEX = /(: any\b|\bas\s+any\b|<any>|\bany\[\]|\bany\(\)|[<,]\s*any\b|\bextends\s+any\b)/g;

interface AnyOccurrence {
  line: number;
  context: string;
}

interface FileReport {
  filePath: string;
  occurrences: AnyOccurrence[];
}

/**
 * Checks whether a file should be processed.
 */
function shouldProcessFile(filePath: string): boolean {
  // Skip this script directory dynamically.
  const absolutePath = path.resolve(filePath);
  if (absolutePath.startsWith(__dirname)) return false;

  // Ensure the file has a valid source code extension.
  const ext = path.extname(filePath).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return false;

  // Skip files whose name/path matches an exclusion pattern.
  return !EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath));
}

/**
 * Collects all files from included directories.
 */
function collectFiles(rootDir: string): string[] {
  const files: string[] = [];

  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_PATTERNS.some(pattern => pattern.test(fullPath))) {
          walkDir(fullPath);
        }
      } else if (entry.isFile() && shouldProcessFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  for (const includePath of INCLUDE_PATHS) {
    const fullPath = path.resolve(rootDir, includePath);
    walkDir(fullPath);
  }
  return files;
}

async function run() {
  const rootDir = process.cwd();
  console.info(`${colors.bright}${colors.blue}🔍 Running any guard (Regex + AST)...${colors.reset}`);

  // Print scanning configuration (regex and path filters) for transparency.
  console.info(`${colors.cyan}   • Busca: ${colors.yellow}${ANY_REGEX.toString()}${colors.reset}`);
  console.info(`${colors.cyan}   • Pastas: ${colors.white}${INCLUDE_PATHS.map(p => `'${p}'`).join(', ')}${colors.reset}`);
  console.info(`${colors.cyan}   • Exclusões: ${colors.gray}${EXCLUDE_PATTERNS.map(p => `'${p.toString()}'`).join(', ')}${colors.reset}\n`);

  const files = collectFiles(rootDir);
  const project = new Project();
  const reports: FileReport[] = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');

    // Skip quickly when file content does not contain the word 'any'.
    if (!content.includes('any')) continue;

    const sourceFile = project.addSourceFileAtPath(filePath);
    const fileOccurrences: AnyOccurrence[] = [];

    // Reseta o index do regex global
    ANY_REGEX.lastIndex = 0;
    let match;

    while ((match = ANY_REGEX.exec(content)) !== null) {
      const pos = match.index + (match[1]?.length || 0);
      const node = sourceFile.getDescendantAtPos(pos);

      if (!node) continue;

      // 1. Ignore occurrences inside comments or string literals.
      const kind = node.getKind();
      if (kind === SyntaxKind.SingleLineCommentTrivia ||
        kind === SyntaxKind.MultiLineCommentTrivia ||
        kind === SyntaxKind.StringLiteral ||
        kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
        continue;
      }

      // 2. Check for @anyAllowed override.
      let current: Node | undefined = node;
      let isAllowed = false;
      while (current) {
        if (Node.isJSDocable(current)) {
          const jsDocs = current.getJsDocs();
          if (jsDocs.some(doc => doc.getText().includes('@anyAllowed'))) {
            isAllowed = true;
            break;
          }
        }
        current = current.getParent();
      }

      if (isAllowed) continue;

      const line = sourceFile.getLineAndColumnAtPos(pos).line;
      const context = match[0].trim();

      // Avoid duplicate findings on the same line.
      if (!fileOccurrences.some(o => o.line === line)) {
        fileOccurrences.push({ line, context });
      }
    }

    if (fileOccurrences.length > 0) {
      reports.push({
        filePath: path.relative(rootDir, filePath),
        occurrences: fileOccurrences,
      });
    }
  }

  // Sort by total number of occurrences.
  reports.sort((a, b) => b.occurrences.length - a.occurrences.length);

  if (reports.length === 0) {
    console.info(`${colors.green}${colors.bright}✨ Success! No forbidden 'any' usage found outside test files.${colors.reset}\n`);
    process.exit(0);
  }

  console.info(`${colors.bright}${colors.red}🚨 FORBIDDEN 'ANY' USAGE FOUND (${reports.reduce((acc, r) => acc + r.occurrences.length, 0)} total)${colors.reset}`);
  console.info(`${colors.gray}${'─'.repeat(60)}${colors.reset}\n`);

  for (const report of reports.slice(0, 20)) { // Show top 20 files
    console.info(`${colors.bright}${report.filePath}${colors.reset} (${colors.yellow}${report.occurrences.length}${colors.reset} ocorrências)`);
    for (const occ of report.occurrences.slice(0, 3)) {
      console.info(`  ${colors.gray}L${occ.line}:${colors.reset} ${occ.context}...`);
    }
    if (report.occurrences.length > 3) {
      console.info(`  ${colors.gray}... e mais ${report.occurrences.length - 3} ocorrências${colors.reset}`);
    }
    console.info();
  }

  if (reports.length > 20) {
    console.info(`${colors.gray}... e mais ${reports.length - 20} arquivos com 'any'.${colors.reset}\n`);
  }

  console.info(`${colors.bright}${colors.red}⚠️  'any' is forbidden by this repository policy.${colors.reset}`);
  console.info(`${colors.red}Replace it with a specific type or 'unknown' to preserve type safety.${colors.reset}\n`);

  process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
