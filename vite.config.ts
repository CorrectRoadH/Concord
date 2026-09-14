import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { unplugin as stylex } from '@stylexjs/unplugin';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => ({
  root: 'web',
  plugins: [stylex.vite({ dev: command === 'serve', runtimeInjection: false }), react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./web', import.meta.url)) } },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'es2022',
    license: true,
  },
}));
