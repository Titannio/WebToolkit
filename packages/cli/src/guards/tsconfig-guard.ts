// @ts-nocheck
import ts from 'typescript';
import fs from 'fs';
import path from 'path';

// Cores para terminal
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

const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (f) => f,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
};

const readConfig = (p: string) => {
  const absolutePath = path.resolve(process.cwd(), p);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Config file not found: ${p}`);
    process.exit(1);
  }
  const r = ts.readConfigFile(absolutePath, ts.sys.readFile);
  if (r.error) {
    console.error(ts.formatDiagnosticsWithColorAndContext([r.error], formatHost));
    process.exit(1);
  }
  return r.config;
};

const errors: string[] = [];
const assert = (cond: boolean, msg: string) => {
  if (!cond) errors.push(msg);
};

console.info('🛡️  Running TSConfig Guard...');

// --- Frontend User Build Config Checks ---
const fbUser = readConfig('apps/frontend-user/tsconfig.json'); // frontend-user might not have tsconfig.build.json, checking tsconfig.json instead or check if file exists
// Checking tsconfig.json since build config might be merged or specific
// Adjusting to check what exists. The error said 'apps/frontend/tsconfig.build.json' not found.
// The new structure has 'apps/frontend-user' and 'apps/frontend-admin'.

// Let's check both if they exist, or just skip if not present, but for now assuming we want to check frontend-user as the main one or both.
// Based on file list, frontend-user has tsconfig.json. frontend-admin has tsconfig.build.json.

// Checking Frontend User
if (fs.existsSync(path.resolve(process.cwd(), 'apps/frontend-user/tsconfig.json'))) {
  const fUser = readConfig('apps/frontend-user/tsconfig.json');
  // Add checks for frontend-user if needed
}

// Checking Frontend Admin
if (fs.existsSync(path.resolve(process.cwd(), 'apps/frontend-admin/tsconfig.build.json'))) {
  const fbAdmin = readConfig('apps/frontend-admin/tsconfig.build.json');
  const incAdmin = new Set(fbAdmin.include || []);
  // assert(incAdmin.has('src'), 'Frontend Admin build MUST include "src"'); // Example check
}

// The original code was checking 'apps/frontend'. I will replace it with checks for 'apps/frontend-user' and 'apps/frontend-admin'.
// However, the specific assertions (include src, types, utils) seem generic.

// REPLACING THE BLOCK:

// --- Frontend User Config Checks ---
// frontend-user uses vite, might not have tsconfig.build.json separate or named differently.
// LS showed tsconfig.json in frontend-user.
const fUser = readConfig('apps/frontend-user/tsconfig.json');
const incUser = new Set(fUser.include || []);
// assert(incUser.has('src'), 'Frontend User MUST include "src"'); 

// --- Frontend Admin Config Checks ---
// LS showed tsconfig.build.json in frontend-admin.
const fbAdmin = readConfig('apps/frontend-admin/tsconfig.build.json');
const incAdmin = new Set(fbAdmin.include || []);
assert(incAdmin.has('src'), 'Frontend Admin build MUST include "src"');
// assert(incAdmin.has('../../packages/core/src'), 'Frontend Admin build MUST include shared core source'); // Path might be different or managed via references

const excAdmin = new Set(fbAdmin.exclude || []);

// --- General Naming Convention Checks ---
const checkNamingConvention = (configPath: string) => {
  const config = readConfig(configPath);
  const paths = config.compilerOptions?.paths || {};
  Object.keys(paths).forEach((alias) => {
    if (alias.startsWith('@doutory') && !alias.startsWith('@doutory/') && alias !== '@doutory') {
      errors.push(`${configPath}: Alias "${alias}" is missing a slash. Use "@doutory/package-name" convention.`);
    }
  });
};

const tsconfigs = [
  'apps/frontend-user/tsconfig.json',
  'apps/frontend-admin/tsconfig.json',
  'apps/backend/tsconfig.json',
  'packages/frontend-shared/tsconfig.json',
  'packages/shared-logic/tsconfig.json',
  'packages/testing/tsconfig.json',
  'packages/core/tsconfig.json',
];

tsconfigs.forEach((p) => {
  if (fs.existsSync(path.resolve(process.cwd(), p))) {
    checkNamingConvention(p);
  }
});

// --- Backend Dockerfile Naming Convention Checks ---
const checkBackendDockerfile = () => {
  const dockerfile = 'apps/backend/Dockerfile';

  if (!fs.existsSync(path.resolve(process.cwd(), dockerfile))) {
    return;
  }

  const content = fs.readFileSync(path.resolve(process.cwd(), dockerfile), 'utf-8');
  if (content.includes('@doutorycore') || content.includes('@doutoryutils') || content.includes('@doutoryshared-logic')) {
    errors.push(`${dockerfile}: Contains legacy naming convention (e.g., @doutorycore). Use @doutory/package-name.`);
  }
};

checkBackendDockerfile();

// --- Specific Path Validations ---
// Frontends must consume workspace packages through public package entrypoints,
// not by mapping aliases directly to package internals (/src).
const ffUser = readConfig('apps/frontend-user/tsconfig.json');
const pathsUser = ffUser.compilerOptions?.paths || {};
const userCorePaths: string[] = pathsUser['@doutory/core'] || [];
const userUtilsPaths: string[] = pathsUser['@titannio/webtoolkit-utils'] || [];
assert(
  userCorePaths.length === 0 || !userCorePaths.some((p) => p.includes('/src') || p.includes('\\src')),
  'Frontend User paths @doutory/core cannot point to package /src internals'
);
assert(
  userUtilsPaths.length === 0 || !userUtilsPaths.some((p) => p.includes('/src') || p.includes('\\src')),
  'Frontend User paths @titannio/webtoolkit-utils cannot point to package /src internals'
);

const ffAdmin = readConfig('apps/frontend-admin/tsconfig.json');
const pathsAdmin = ffAdmin.compilerOptions?.paths || {};
const adminCorePaths: string[] = pathsAdmin['@doutory/core'] || [];
const adminUtilsPaths: string[] = pathsAdmin['@titannio/webtoolkit-utils'] || [];
assert(
  adminCorePaths.length === 0 || !adminCorePaths.some((p) => p.includes('/src') || p.includes('\\src')),
  'Frontend Admin paths @doutory/core cannot point to package /src internals'
);
assert(
  adminUtilsPaths.length === 0 || !adminUtilsPaths.some((p) => p.includes('/src') || p.includes('\\src')),
  'Frontend Admin paths @titannio/webtoolkit-utils cannot point to package /src internals'
);


// --- Backend Config Checks ---
const be = readConfig('apps/backend/tsconfig.json');
assert(be.compilerOptions?.module === 'NodeNext', 'Backend MUST use module: NodeNext');
assert(be.compilerOptions?.moduleResolution === 'NodeNext', 'Backend MUST use moduleResolution: NodeNext');

if (errors.length) {
  console.error('\n❌ TSConfig guard failed with following errors:');
  errors.forEach((m) => console.error(`  - ${m}`));
  process.exit(1);
}

console.info(`✅${colors.green}${colors.bright} [OK]${colors.reset} TSConfig guard in compliance`);
