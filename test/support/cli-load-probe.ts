import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { plugin } from 'bun';

// Do not preload Effect: the probe must also observe the zero-Effect entry.
const loaded = new Set<string>();
plugin({ name: 'concord-test-module-loads', setup(build) {
  build.onLoad({ filter: /(?<!\/model\/markdown-parser)\.ts$/u }, ({ path }) => {
    loaded.add(pathToFileURL(path).href);
    return { contents: readFileSync(path, 'utf8'), loader: 'ts' };
  });
} });
process.once('exit', () => {
  const output = process.env.CONCORD_TEST_LOADED_MODULES;
  if (output !== undefined) writeFileSync(output, JSON.stringify([...loaded, ...Object.keys(createRequire(import.meta.url).cache)]));
});
