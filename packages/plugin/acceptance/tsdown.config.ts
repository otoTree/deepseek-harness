import { defineConfig } from 'tsdown'

/** Build the acceptance fixture's shared, Host, and Client entry points. */
export default defineConfig({
  entry: ['lib/types/{index,host,client}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
