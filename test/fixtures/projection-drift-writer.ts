import { closeSync, openSync, writeSync } from 'node:fs';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';

const main = Effect.scoped(Effect.gen(function*() {
  const [path] = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String]))(process.argv.slice(2));
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs.readFileString(path);
  const prefix = path.endsWith('.md') ? '\n<!-- edit ' : '\n// edit ';
  const suffix = path.endsWith('.md') ? ' -->\n' : '\n';
  const position = Buffer.byteLength(source + prefix);
  yield* fs.writeFileString(path, source + prefix + '0'.repeat(16) + suffix);
  const fd = yield* Effect.acquireRelease(Effect.sync(() => openSync(path, 'r+')), descriptor => Effect.sync(() => closeSync(descriptor)));
  let counter = 0;
  const edit = Effect.sync(() => { writeSync(fd, String(++counter).padStart(16, '0'), position, 'utf8'); });
  yield* edit;
  yield* Effect.sync(() => { process.stdout.write('ready'); });
  for (;;) { yield* Effect.sleep('2 millis'); yield* edit; }
}));

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
