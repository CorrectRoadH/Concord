import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { tmpdir } from '../support/temporary.ts';

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

// @feature docs/engineering/build/architecture.md#从源码运行
test('plain TypeScript checks emit nothing and only an explicit external build emits JavaScript', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-typecheck-output-'));
  const output = mkdtempSync(join(tmpdir(), 'concord-explicit-build-'));
  try {
    writeFileSync(join(root, 'tsconfig.json'), readFileSync(resolve('tsconfig.json')));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/main.ts'), 'export const answer = 42;\n');
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'));
    const compiler = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc');
    execFileSync(process.execPath, [compiler, '-p', join(root, 'tsconfig.json')], { encoding: 'utf8' });
    assert.equal(existsSync(join(root, 'dist')), false, 'type checks must never emit checkout artifacts');
    execFileSync(process.execPath, [compiler, '-p', join(root, 'tsconfig.json'), '--noEmit', 'false', '--outDir', output], { encoding: 'utf8' });
    assert.equal(existsSync(join(root, 'dist')), false);
    assert.match(readFileSync(join(output, 'main.js'), 'utf8'), /export const answer = 42/u);
    assert.equal(existsSync(join(output, 'main.d.ts')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
})));
