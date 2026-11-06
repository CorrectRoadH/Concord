import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runSourceWeb, sourceWebDigest, sourceWebInputDigest, sourceWebRuntimeImports } from '../../src/base/installation/index.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

const checkout = fileURLToPath(new URL('../..', import.meta.url));

// @feature docs/engineering/build/architecture.md#从源码运行
test('Web digest follows runtime shared inputs and ignores CLI, scripts, type-only references and package scripts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-web-inputs-'));
  const write = (path: string, value: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  try {
    symlinkSync(join(checkout, 'node_modules'), join(root, 'node_modules'), 'junction');
    for (const path of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vite.source.config.ts', 'vite.preview.config.ts', 'src/base/installation/source-web-inputs.ts', 'src/base/installation/source-web-cache.ts', 'src/base/installation/source-web-builder.ts']) write(path, '');
    write('package.json', '{"dependencies":{},"scripts":{"concord":"before"}}');
    write('web/main.tsx', 'import { value } from "../src/model/index.ts"; import type { NeverRead } from "../src/domain/unused.ts"; export default <div>{value}#</div>');
    write('web/styles.css', 'body { color: red }');
    write('src/model/index.ts', 'export { value } from "./shared.ts"; export type { NeverRead } from "../domain/unused.ts";');
    write('src/model/shared.ts', 'export const value = 1;');
    const digest = () => runSourceWeb(sourceWebDigest(root), nativeRuntime);
    const first = await digest();
    write('src/entry/cli/main.ts', 'export const cli = 2;');
    write('src/entry/server/main.ts', 'export const server = 2;');
    write('scripts/build.ts', 'export const script = 2;');
    write('package.json', '{"dependencies":{},"scripts":{"concord":"after"}}');
    assert.equal(await digest(), first);
    write('src/model/shared.ts', 'export const value = 2;');
    assert.notEqual(await digest(), first, 'runtime re-exports participate');
    write('src/model/shared.ts', 'export const value = 1;');
    assert.equal(await digest(), first, 'restoring bytes restores the key');
    for (const path of ['web/main.tsx', 'web/styles.css', 'vite.source.config.ts', 'vite.preview.config.ts', 'pnpm-lock.yaml']) {
      const bytes = readFileSync(join(root, path), 'utf8');
      write(path, `${bytes}\n/* changed */`);
      assert.notEqual(await digest(), first, path);
      write(path, bytes);
    }
    write('web/new.svg', '<svg/>');
    assert.notEqual(await digest(), first, 'directory membership participates');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/engineering/build/architecture.md#从源码运行
test('Web input identity is order independent and lexical imports exclude erased bindings and comments', () => {
  const files = new Map([['a', Buffer.from('bc')], ['ab', Buffer.from('c')]]);
  assert.equal(sourceWebInputDigest(files), sourceWebInputDigest(new Map([...files].reverse())));
  assert.notEqual(sourceWebInputDigest(files), sourceWebInputDigest(new Map([['a', Buffer.from('b')], ['ab', Buffer.from('cc')]])));
  assert.deepEqual(sourceWebRuntimeImports(`
    // import { A } from './comment.ts';
    import type { B } from './type.ts';
    import { type C } from './inline-type.ts';
    import { value, type D } from './runtime.ts';
    export type { E } from './export-type.ts';
    export { value } from './shared.ts';
    const lazy = import('./lazy.ts');
    const template = \`text #\`;
  `), ['./runtime.ts', './shared.ts', './lazy.ts']);
});
