import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { tmpdir } from '../support/temporary.js';

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('all repository TypeScript checks exclude a published mod subtree', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-published-types-'));
  try {
    const configs = ['tsconfig.json', 'tsconfig.scripts.json', 'tsconfig.test.json', 'tsconfig.web.json'];
    for (const config of configs) writeFileSync(join(root, config), readFileSync(resolve(config)));
    for (const path of ['src/main.ts', 'scripts/main.ts', 'bench/main.ts', 'test/main.test.ts', 'web/main.ts', 'concord/src/broken.ts', 'concord/test/broken.test.ts', 'concord/mods/concord/main.ts']) {
      const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, 'export const source = true;');
    }
    for (const config of configs) {
      const path = join(root, config);
      const compiler = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc');
      const output = execFileSync(process.execPath, [compiler, '--showConfig', '--project', path], { encoding: 'utf8' });
      const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ files: Schema.Array(Schema.String) })), { onExcessProperty: 'ignore' })(output);
      assert.ok(parsed.files.length > 0, config);
      assert.ok(parsed.files.every(file => !resolve(root, file).startsWith(join(root, 'concord/'))), config);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
