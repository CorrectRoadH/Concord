import { defineConfig, type Plugin } from 'vite-plus';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { unplugin as stylex } from '@stylexjs/unplugin';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { acquireBuildLock, type BuildLock } from './scripts/build-lock.js';

// Only production builds prepare the complete CLI distribution. Dev stays Web-only.
let buildLock: BuildLock | undefined;
const releaseBuildLock = async () => { const lock = buildLock; buildLock = undefined; await lock?.release(); };
const distribution: Plugin = {
  name: 'concord-distribution',
  apply: 'build',
  async configResolved() { buildLock = await Effect.runPromise(acquireBuildLock()); },
  async buildStart() { await (await import('./scripts/distribution.js')).prepareDistribution(); },
  async writeBundle() { await (await import('./scripts/distribution.js')).finishDistribution(); },
  async buildEnd(error) { if (error) await releaseBuildLock(); },
  async closeBundle() { await releaseBuildLock(); },
};

export default defineConfig(({ command }) => ({
  run: { cache: false },
  root: 'web',
  plugins: [distribution, stylex.vite({ dev: command === 'serve', runtimeInjection: false }), react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./web', import.meta.url)) } },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // Keep fonts same-origin files: the View CSP intentionally disallows data fonts.
    assetsInlineLimit: (filePath) => /\.(?:woff2?|ttf|otf)$/i.test(filePath) ? false : undefined,
    target: 'es2022',
    license: true,
  },
}));
