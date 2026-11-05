import { defineConfig, type Plugin } from 'vite-plus';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { unplugin as stylex } from '@stylexjs/unplugin';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { externalBuildOutput } from './scripts/build-output.js';

// Only production builds prepare the complete CLI distribution. Dev stays Web-only.
const distribution = (output: string): Plugin => ({
  name: 'concord-distribution',
  apply: 'build',
  configResolved(config) {
    config.build.outDir = resolve(output, 'dist/web');
    if (config.environments.client) config.environments.client.build.outDir = resolve(output, 'dist/web');
  },
  async buildStart() { await (await import('./scripts/distribution.js')).prepareDistribution(output); },
  async writeBundle() { await (await import('./scripts/distribution.js')).finishDistribution(output); },
});

export default defineConfig(({ command }) => {
  const index = process.argv.findIndex(value => value === '--outDir');
  const output = command === 'build' ? externalBuildOutput(index < 0 ? undefined : process.argv[index + 1]) : undefined;
  return ({
  run: { cache: false },
  root: 'web',
  plugins: [...(output === undefined ? [] : [distribution(output)]), stylex.vite({ dev: command === 'serve', runtimeInjection: false }), react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./web', import.meta.url)) } },
  build: {
    outDir: output === undefined ? undefined : resolve(output, 'dist/web'),
    emptyOutDir: true,
    // Keep fonts same-origin files: the View CSP intentionally disallows data fonts.
    assetsInlineLimit: (filePath) => /\.(?:woff2?|ttf|otf)$/i.test(filePath) ? false : undefined,
    target: 'es2022',
    license: true,
  },
}); });
