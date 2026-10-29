import { registerHooks } from 'node:module';
import { Effect } from 'effect';

// Instrument calls at the real parser boundary, preserving its implementation.
Effect.runSync(Effect.sync(() => registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!url.endsWith('/dist/markdown-parser.js')) return loaded;
  const source = String(loaded.source);
  const needle = 'return parser.fromMarkdown(source);';
  if (!source.includes(needle)) throw new Error('Markdown call instrumentation no longer matches the built parser');
  return { ...loaded, source: source.replace(needle,
    'process.getBuiltinModule("fs").appendFileSync(process.env.CONCORD_TEST_PARSE_COUNTS, JSON.stringify(source) + "\\n"); ' + needle) };
} })));
