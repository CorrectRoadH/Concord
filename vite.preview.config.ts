import { defineConfig } from 'vite-plus';
import react from '@vitejs/plugin-react';
import { unplugin as stylex } from '@stylexjs/unplugin';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('./web/preview',import.meta.url)),base:'./',envDir:false,
  plugins:[stylex.vite({dev:false,runtimeInjection:false}),react()],
  resolve:{alias:{'@':fileURLToPath(new URL('./web',import.meta.url))}},
  build:{outDir:'../../dist/preview',emptyOutDir:true,target:'es2022',license:false},
});
