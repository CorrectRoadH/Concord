import { defineConfig, type Plugin } from 'vite-plus';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { unplugin as stylex } from '@stylexjs/unplugin';
import { fileURLToPath } from 'node:url';

// Only production builds prepare the complete CLI distribution. Dev stays Web-only.
const distribution: Plugin = {
  name: 'concord-distribution',
  apply: 'build',
  async buildStart() { await (await import('./scripts/distribution.js')).prepareDistribution(); },
  async writeBundle() { await (await import('./scripts/distribution.js')).finishDistribution(); },
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
