import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
    // the integration tests share one database: run files one after another
    fileParallelism: false,
  },
})
