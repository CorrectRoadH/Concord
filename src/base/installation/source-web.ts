// @concord-file
// @concord-implements docs/engineering/build/architecture.md#从源码运行
import { basename, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Effect, FileSystem } from 'effect';
import type { RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { readWebReceipt, runSourceWeb, sourceWebArtifact, webFailure } from './source-web-cache.ts';

/** Services hold paths only; compilation and its module graph belong to the builder process. */
export async function sourceWebServer(runtime: RuntimeEnvironmentSnapshot) {
  const { directory, names } = await runSourceWeb(Effect.gen(function*() {
    const directory = yield* sourceWebArtifact();
    const receipt = yield* readWebReceipt(directory, basename(directory));
    return { directory, names: new Set(receipt.files.filter(file => file.path.startsWith('web/')).map(file => file.path.slice(4))) };
  }), runtime);
  let closed = false;
  return {
    serve: async (request: IncomingMessage, response: ServerResponse, send: (bytes: Buffer) => void): Promise<void> => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname.slice(1);
      const file = closed ? undefined : names.has(path) ? path : !path.startsWith('assets/') ? 'index.html' : undefined;
      if (file === undefined) { response.statusCode = 404; response.end(); return; }
      const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.woff') ? 'font/woff' : path.endsWith('.ttf') ? 'font/ttf' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
      const bytes = await runSourceWeb(Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem;
        return yield* fs.readFile(join(directory, 'web', file));
      }).pipe(Effect.mapError(webFailure('read'))), runtime);
      response.setHeader('Content-Type', type);
      if (path.startsWith('assets/')) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      send(Buffer.from(bytes));
    },
    close: async () => { closed = true; },
  };
}

export async function sourceP5Runtime(runtime: RuntimeEnvironmentSnapshot): Promise<string> {
  return runSourceWeb(Effect.gen(function*() {
    const directory = yield* sourceWebArtifact();
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(join(directory, 'p5/runtime.js'));
  }).pipe(Effect.mapError(webFailure('read'))), runtime);
}

export async function sourcePreviewFiles(runtime: RuntimeEnvironmentSnapshot): Promise<Map<string, Buffer>> {
  return runSourceWeb(Effect.gen(function*() {
    const directory = yield* sourceWebArtifact();
    const receipt = yield* readWebReceipt(directory, basename(directory));
    const fs = yield* FileSystem.FileSystem;
    const files = new Map<string, Buffer>();
    for (const file of receipt.files.filter(file => file.path.startsWith('preview/'))) files.set(file.path.slice(8), Buffer.from(yield* fs.readFile(join(directory, file.path))));
    return files;
  }).pipe(Effect.mapError(webFailure('read'))), runtime);
}
