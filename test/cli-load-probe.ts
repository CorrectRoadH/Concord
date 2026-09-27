import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import * as Effect from 'effect/Effect';

// This process-local loader observes the real built CLI without timing assertions.
Effect.runSync(Effect.sync(() => {
  const loaded = new Set<string>();
  registerHooks({ load(url, context, nextLoad) {
    loaded.add(url);
    return nextLoad(url, context);
  } });
  process.once('exit', () => {
    const output = process.env.CONCORD_TEST_LOADED_MODULES;
    if (output !== undefined) writeFileSync(output, JSON.stringify([...loaded]));
  });
}));
