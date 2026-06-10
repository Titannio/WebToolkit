import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
  },
})
