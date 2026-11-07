import { readFileSync } from 'node:fs';
import { plugin } from 'bun';

// Instrument calls at the real parser boundary, preserving its implementation.
plugin({ name: 'concord-test-markdown-parses', setup(build) {
  build.onLoad({ filter: /\/model\/markdown-parser\.ts$/u }, ({ path }) => {
    const source = readFileSync(path, 'utf8');
    const needle = /return parse\(\.\.\.args\);?/u;
    if (!needle.test(source)) throw new Error('Markdown call instrumentation no longer matches the source parser');
    return { loader: 'ts', contents: source.replace(needle,
      'process.getBuiltinModule("fs").appendFileSync(process.env.CONCORD_TEST_PARSE_COUNTS, JSON.stringify(args[0]) + "\\n"); ' + '$&') };
  });
} });
