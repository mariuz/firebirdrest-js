import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/gen.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'es2020',
  },
  {
    // the command: Node only
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
  },
])
