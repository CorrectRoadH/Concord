import { defineConfig, type Plugin } from 'vite-plus';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { unplugin as stylex } from '@stylexjs/unplugin';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { externalBuildOutput } from './scripts/build-output.ts';
import { Effect } from 'effect';
import { NodeServices } from '@effect/platform-node';

// Only production builds prepare the complete CLI distribution. Dev stays Web-only.
const distribution = (output: string): Plugin => ({
  name: 'concord-distribution',
  apply: 'build',
  async buildStart() { await (await import('./scripts/distribution.ts')).buildDistribution(output); },
});

export default defineConfig(async ({ command }) => {
  const building = command === 'build' && process.argv[2] === 'build';
  if (building) (await import('./scripts/archive-support.ts')).archiveTarget();
  const index = process.argv.findIndex(value => value === '--outDir');
  const output = building ? await Effect.runPromise(externalBuildOutput(index < 0 ? undefined : process.argv[index + 1]).pipe(Effect.provide(NodeServices.layer))) : undefined;
  return ({
  lint: {
    plugins: ['import', 'typescript', 'unicorn'],
    categories: { correctness: 'off' },
    rules: {
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      'import/no-default-export': 'error',
      'typescript/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
    overrides: [{
      files: ['src/entry/herdr-mod/main.ts', 'bench/*.bench.ts', '*.config.ts'],
      rules: { 'import/no-default-export': 'off' },
    }],
  },
  run: { cache: false, tasks: {
    'gate:lint': { command: 'vp lint src web test scripts bench *.config.ts', cache: false },
    'gate:source': { command: 'node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit', cache: false },
    'gate:tests': { command: 'node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit', cache: false },
    'gate:scripts': { command: 'node node_modules/typescript/bin/tsc -p tsconfig.scripts.json --noEmit', cache: false },
    'gate:web': { command: 'node node_modules/typescript/bin/tsc -p tsconfig.web.json --noEmit', cache: false },
    'gate:selfhost': { command: 'bun --no-env-file --config=/dev/null src/entry/cli/entry.ts --json --dry-run check', cache: false },
    'test:source': { command: 'node scripts/test-built.ts', cache: false },
  } },
  root: 'web',
  plugins: output === undefined ? [stylex.vite({ dev: true, runtimeInjection: false }), react(), tailwindcss()] : [distribution(output)],
  resolve: { alias: { '@': fileURLToPath(new URL('./web', import.meta.url)) } },
  build: {
    ...(output === undefined ? {} : { write: false, lib: { entry: resolve('scripts/archive-empty.ts'), formats: ['es'] as ['es'] } }),
    outDir: output === undefined ? undefined : resolve(output, '.vite-no-output'),
    emptyOutDir: true,
    // Keep fonts same-origin files: the View CSP intentionally disallows data fonts.
    assetsInlineLimit: (filePath) => /\.(?:woff2?|ttf|otf)$/i.test(filePath) ? false : undefined,
    target: 'es2022',
    license: true,
  },
}); });
