import { writeFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';

// Do not preload Effect: the probe must also observe the zero-Effect entry.
const loaded = new Set<string>();
registerHooks({ load(url, context, nextLoad) {
  loaded.add(url);
  return nextLoad(url, context);
} });
process.once('exit', () => {
  const output = process.env.CONCORD_TEST_LOADED_MODULES;
  if (output !== undefined) writeFileSync(output, JSON.stringify([...loaded, ...Object.keys(createRequire(import.meta.url).cache)]));
});
