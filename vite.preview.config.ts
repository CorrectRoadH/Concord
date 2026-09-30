import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { unplugin as stylex } from '@stylexjs/unplugin';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root:'web/preview',base:'./',
  plugins:[stylex.vite({dev:false,runtimeInjection:false}),react()],
  resolve:{alias:{'@':fileURLToPath(new URL('./web',import.meta.url))}},
  build:{outDir:'../../dist/preview',emptyOutDir:true,target:'es2022',license:false},
});
