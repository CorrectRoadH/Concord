import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { packageRoot } from './location.js';

/** Compile this server's source snapshot with Vite; no checkout build or HMR client. */
export async function sourceWebServer() {
  const { build } = await import('vite-plus');
  const result = await build({ configFile: join(packageRoot, 'vite.source.config.ts'), mode: 'production', logLevel: 'error',
    build: { write: false, minify: false }, configLoader: 'native' });
  const files = outputs(result);
  return {
    serve: async (request: IncomingMessage, response: ServerResponse, send: (bytes: Buffer) => void): Promise<void> => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname.slice(1);
      const file = files.get(path) ?? (!path.startsWith('assets/') ? files.get('index.html') : undefined);
      if (file === undefined) { response.statusCode = 404; response.end(); return; }
      const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.woff') ? 'font/woff' : path.endsWith('.ttf') ? 'font/ttf' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
      response.setHeader('Content-Type', type);
      if (path.startsWith('assets/')) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      send(file);
    },
    close: async () => { files.clear(); },
  };
}

function outputs(result: Awaited<ReturnType<typeof import('vite-plus')['build']>>): Map<string, Buffer> {
  const output = (Array.isArray(result) ? result : [result]).flatMap(item => 'output' in item ? item.output : []);
  return new Map(output.map(item => [item.fileName, Buffer.from(item.type === 'chunk' ? item.code : item.source)]));
}

export async function sourceP5Runtime(): Promise<string> {
  const { build } = await import('esbuild');
  const output = await build({ entryPoints: [join(packageRoot, 'web/p5/runtime.ts')], write: false, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, define: { IS_MINIFIED: 'true' } });
  return output.outputFiles[0]!.text;
}

export async function sourcePreviewFiles(): Promise<Map<string, Buffer>> {
  const { build } = await import('vite-plus');
  const result = await build({ configFile: join(packageRoot, 'vite.preview.config.ts'), build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => 'output' in item ? item.output : []);
  const files = new Map(outputs.map(item => [item.fileName, Buffer.from(item.type === 'chunk' ? item.code : item.source)]));
  const license = readFileSync(join(packageRoot, 'node_modules/@fontsource-variable/noto-sans-sc/LICENSE'), 'utf8');
  files.set('FONT-LICENSE.html', Buffer.from(`<!doctype html><meta charset="utf-8"><title>Font license</title><pre>${license.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`));
  return files;
}
