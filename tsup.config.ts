import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  target: 'node18',
  splitting: false,
  // En CommonJS: const { FactuSmart } = require('factusmart')  (también existe .default)
})
