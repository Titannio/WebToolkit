import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'dist/**',
        'node_modules/**',
        'src/guards/**',
        'src/bin.ts',
        'src/environment.ts',
        'src/dev-watch.ts',
        'src/jsdoc-report.ts',
        'src/upgrade.ts',
        'src/workspace-tests.ts',
        'src/cleaner.ts',
        'src/process.ts',
        'src/dev-grid.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
