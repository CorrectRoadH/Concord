import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Effect, Schema } from 'effect';
import type { HawdbDatabase } from '../../src/hawdb-native.js';
import { pollUntil } from '../support.js';

await Effect.runPromise(Effect.tryPromise(async () => {
  const [loader, ready, release] = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.String, Schema.String]))(process.argv.slice(2));
  const native = await import(pathToFileURL(loader).href) as typeof import('../../src/hawdb-native.js');
  let database: HawdbDatabase | undefined = native.createMemoryHawdb();
  database.put('document_parse', [{ key: 'mapped', payload: 'native image remains loaded' }]);
  database.close();
  writeFileSync(ready, 'ready');
  await pollUntil(async () => existsSync(release) ? true : undefined, { description: 'native fixture replacement' });
  database = undefined;
  assert.ok(globalThis.gc);
  for (let index = 0; index < 4; index++) {
    globalThis.gc();
    await new Promise<void>(done => setImmediate(done));
  }
}));
