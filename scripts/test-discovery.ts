import { Effect, FileSystem } from 'effect';
import { join } from 'node:path';

/** One sorted recursive discovery set, shared by all layers and shards. */
export const discoverTests = Effect.fn('test.discover')(function*(directory = 'test'): Effect.fn.Return<readonly string[], import('effect/PlatformError').PlatformError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const visit = Effect.fn('test.discover.directory')(function*(path: string): Effect.fn.Return<string[], import('effect/PlatformError').PlatformError, FileSystem.FileSystem> {
    const files: string[] = [];
    for (const name of (yield* fs.readDirectory(path)).sort()) {
      const file = join(path, name), stat = yield* fs.stat(file);
      if (stat.type === 'Directory') files.push(...yield* visit(file));
      else if (stat.type === 'File' && /\.(?:test|e2e)\.ts$/u.test(name)) files.push(file);
    }
    return files;
  });
  return (yield* visit(directory)).sort();
});
