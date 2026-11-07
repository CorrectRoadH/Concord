import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { unplugin as stylex } from '@stylexjs/unplugin';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  envDir: false,
  root: fileURLToPath(new URL('./web', import.meta.url)),
  plugins: [stylex.vite({ dev: false, runtimeInjection: false }), react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./web', import.meta.url)) } },
  build: { write: false, target: 'es2022', minify: false, assetsInlineLimit: file => /\.(?:woff2?|ttf|otf)$/iu.test(file) ? false : undefined },
});
