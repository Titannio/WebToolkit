#!/usr/bin/env tsx
// @ts-nocheck
/**
 * Internal Link Guard
 *
 * Prevents internal SPA navigation through raw <a href="...">.
 * For React routes, use <Link to="..."> from react-router-dom.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Project,
  SyntaxKind,
  type JsxAttribute,
  type JsxOpeningElement,
  type JsxSelfClosingElement,
} from 'ts-morph';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

const WATCH_PATHS = [
  'apps/frontend-user/src',
  'apps/frontend-admin/src',
  'packages/frontend-shared/src',
];

const EXCLUDE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /__tests__/,
  /\.stories\./,
];

type Violation = {
  filePath: string
  line: number
  hrefSnippet: string
  reason: string
};

type HrefKind = 'internal' | 'external' | 'placeholder' | 'other';

function shouldSkipFile(filePath: string): boolean {
  if (!filePath.match(/\.(tsx|jsx)$/)) return true;
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function collectFiles(rootDir: string): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && !shouldSkipFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  for (const relativePath of WATCH_PATHS) {
    walk(path.resolve(rootDir, relativePath));
  }

  return files;
}

function isInternalHrefLiteral(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) return false;
  if (normalized.startsWith('http://')) return false;
  if (normalized.startsWith('https://')) return false;
  if (normalized.startsWith('mailto:')) return false;
  if (normalized.startsWith('tel:')) return false;
  if (normalized.startsWith('#')) return false;
  return normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../');
}

function isExternalHttpHrefLiteral(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('http://') || normalized.startsWith('https://');
}

function parseJsxAttributeStaticValue(attr?: JsxAttribute): string | null {
  if (!attr) return null;
  const initializer = attr.getInitializer();
  if (!initializer) return null;

  if (initializer.getKind() === SyntaxKind.StringLiteral) {
    return initializer.getText().slice(1, -1);
  }

  if (initializer.getKind() !== SyntaxKind.JsxExpression) {
    return null;
  }

  const expression = initializer.asKind(SyntaxKind.JsxExpression)?.getExpression();
  if (!expression) return null;

  if (expression.getKind() === SyntaxKind.StringLiteral || expression.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return expression.getText().slice(1, -1);
  }

  return null;
}

function inspectHrefAttribute(attr: JsxAttribute): { kind: HrefKind; reason?: string; snippet: string } {
  const initializer = attr.getInitializer();
  const snippet = attr.getText();
  if (!initializer) return { kind: 'other', snippet };

  if (initializer.getKind() === SyntaxKind.StringLiteral) {
    const literalValue = initializer.getText().slice(1, -1);
    if (literalValue.trim() === '#') {
      return {
        kind: 'placeholder',
        reason: 'href="#"',
        snippet,
      };
    }
    if (isExternalHttpHrefLiteral(literalValue)) {
      return {
        kind: 'external',
        reason: `href="${literalValue}"`,
        snippet,
      };
    }
    if (isInternalHrefLiteral(literalValue)) {
      return {
        kind: 'internal',
        reason: `href="${literalValue}"`,
        snippet,
      };
    }
    return { kind: 'other', snippet };
  }

  if (initializer.getKind() !== SyntaxKind.JsxExpression) {
    return { kind: 'other', snippet };
  }

  const expression = initializer.asKind(SyntaxKind.JsxExpression)?.getExpression();
  if (!expression) return { kind: 'other', snippet };

  if (expression.getKind() === SyntaxKind.StringLiteral || expression.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    const text = expression.getText();
    const value = text.slice(1, -1);
    if (value.trim() === '#') {
      return {
        kind: 'placeholder',
        reason: `href={${text}}`,
        snippet,
      };
    }
    if (isExternalHttpHrefLiteral(value)) {
      return {
        kind: 'external',
        reason: `href={${text}}`,
        snippet,
      };
    }
    if (isInternalHrefLiteral(value)) {
      return {
        kind: 'internal',
        reason: `href={${text}}`,
        snippet,
      };
    }
  }

  const expressionText = expression.getText().trim();
  const looksLikeInternalRouteExpression =
    expressionText.includes('ROUTES.') ||
    expressionText.startsWith('`/') ||
    expressionText.startsWith('"/') ||
    expressionText.startsWith("'/") ||
    expressionText.startsWith('`./') ||
    expressionText.startsWith('`../');

  if (looksLikeInternalRouteExpression) {
    return {
      kind: 'internal',
      reason: `href={${expressionText}}`,
      snippet,
    };
  }

  return { kind: 'other', snippet };
}

function hasSecureRel(relValue: string | null): boolean {
  if (!relValue) return false;
  const tokens = new Set(
    relValue
      .trim()
      .split(/\s+/)
      .map((token) => token.toLowerCase()),
  );
  return tokens.has('noopener') && tokens.has('noreferrer');
}

function getAnchorViolationsFromNode(
  node: JsxOpeningElement | JsxSelfClosingElement,
  sourceRelativePath: string,
): Violation[] {
  if (node.getTagNameNode().getText() !== 'a') return [];
  const attrs = node
    .getAttributes()
    .map((attr) => attr.asKind(SyntaxKind.JsxAttribute))
    .filter((attr): attr is JsxAttribute => Boolean(attr));
  const hrefAttr = attrs.find((attr) => attr.getNameNode().getText() === 'href');
  const targetAttr = attrs.find((attr) => attr.getNameNode().getText() === 'target');
  const relAttr = attrs.find((attr) => attr.getNameNode().getText() === 'rel');
  const targetValue = parseJsxAttributeStaticValue(targetAttr);
  const relValue = parseJsxAttributeStaticValue(relAttr);
  const violations: Violation[] = [];

  if (targetValue === '_blank' && !hasSecureRel(relValue)) {
    violations.push({
      filePath: sourceRelativePath,
      line: (relAttr ?? targetAttr ?? node).getStartLineNumber(),
      hrefSnippet: relAttr?.getText() ?? targetAttr?.getText() ?? '<a target="_blank">',
      reason: 'target="_blank" requires rel="noopener noreferrer"',
    });
  }

  if (!hrefAttr) return violations;

  const check = inspectHrefAttribute(hrefAttr);
  if (check.kind === 'other') return violations;

  if (check.kind === 'internal') {
    violations.push({
      filePath: sourceRelativePath,
      line: hrefAttr.getStartLineNumber(),
      hrefSnippet: check.snippet,
      reason: check.reason ?? 'internal href detected',
    });
    return violations;
  }

  if (check.kind === 'placeholder') {
    violations.push({
      filePath: sourceRelativePath,
      line: hrefAttr.getStartLineNumber(),
      hrefSnippet: check.snippet,
      reason: 'placeholder href detected (use button or real route instead of "#")',
    });
    return violations;
  }

  if (targetValue !== '_blank') {
    violations.push({
      filePath: sourceRelativePath,
      line: hrefAttr.getStartLineNumber(),
      hrefSnippet: check.snippet,
      reason: `external link must use target="_blank" (${check.reason ?? 'external href'})`,
    });
  }

  if (!hasSecureRel(relValue)) {
    violations.push({
      filePath: sourceRelativePath,
      line: hrefAttr.getStartLineNumber(),
      hrefSnippet: relAttr?.getText() ?? check.snippet,
      reason: 'external link must include rel="noopener noreferrer"',
    });
  }

  return violations;
}

async function run() {
  const rootDir = process.cwd();
  console.info(`${colors.bright}${colors.blue}🔗 Checking internal navigation links...${colors.reset}`);

  const files = collectFiles(rootDir);
  const project = new Project();
  const violations: Violation[] = [];

  for (const absoluteFilePath of files) {
    const sourceFile = project.addSourceFileAtPath(absoluteFilePath);
    const relativePath = path.relative(rootDir, absoluteFilePath);

    sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).forEach((node) => {
      violations.push(...getAnchorViolationsFromNode(node, relativePath));
    });
    sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).forEach((node) => {
      violations.push(...getAnchorViolationsFromNode(node, relativePath));
    });
  }

  if (violations.length === 0) {
    console.info(`${colors.green}${colors.bright}✅ [OK]${colors.reset} Internal links are router-safe.`);
    process.exit(0);
  }

  console.info(`${colors.bright}${colors.yellow}⚠️  FOUND LINK POLICY VIOLATIONS${colors.reset}`);
  console.info(`${colors.gray}Policies:${colors.reset}`);
  console.info(`${colors.gray} - use <Link to=\"...\"> for internal app navigation${colors.reset}`);
  console.info(`${colors.gray} - do not use href=\"#\" placeholders${colors.reset}`);
  console.info(`${colors.gray} - external http(s) links must use target=\"_blank\" and rel=\"noopener noreferrer\"${colors.reset}\n`);

  for (const violation of violations) {
    console.info(`${colors.gray}${violation.filePath}:${violation.line}${colors.reset}`);
    console.info(`   ${colors.red}→${colors.reset} ${violation.reason}`);
    console.info(`   ${colors.gray}${violation.hrefSnippet}${colors.reset}\n`);
  }

  console.info(`${colors.bright}${colors.red}⚠️  IMPORTANT: Fix link policy violations before proceeding.${colors.reset}\n`);
  process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
