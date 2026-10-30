import { registerHooks } from 'node:module';
import { Effect } from 'effect';

// Instrument calls at the real parser boundary, preserving its implementation.
Effect.runSync(Effect.sync(() => registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!url.endsWith('/src/model/markdown-parser.ts')) return loaded;
  const source = String(loaded.source);
  const needle = /return parse\(\.\.\.args\);?/u;
  if (!needle.test(source)) throw new Error('Markdown call instrumentation no longer matches the source parser');
  return { ...loaded, source: source.replace(needle,
    'process.getBuiltinModule("fs").appendFileSync(process.env.CONCORD_TEST_PARSE_COUNTS, JSON.stringify(args[0]) + "\\n"); ' + '$&') };
} })));
