// Bundles the control add-in into one script inside the AL app.
// The SQLite WebAssembly binary is embedded in the bundle, so the add-in needs no other files.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  loader: { '.wasm': 'binary' },
  external: ['fs', 'path', 'crypto', 'node:fs', 'node:path', 'node:crypto'], // Node-only branches of sql.js, never reached in the browser
  legalComments: 'eof',
  outfile: '../app/ControlAddIn/js/sqm.js',
  logLevel: 'info',
});
