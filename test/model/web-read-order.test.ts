import assert from 'node:assert/strict';
import test from 'node:test';
import { ConcordApi } from '../../web/lib/api.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('browser reads queue after prior reads, including a read requested after a write', async t => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const value = { path: 'first.md', digest: 'first', body: '' };
  globalThis.fetch = async (input, init) => {
    const path = String(input); calls.push(path);
    if (path.includes('first.md')) await held;
    return Response.json({ ok: true, value });
  };
  t.after(() => { globalThis.fetch = original; });
  const api = new ConcordApi();
  const first = api.file('first.md');
  const second = api.file('second.md');
  await api.action({ action: 'source.set', path: 'src/a.ts', body: '', expectedDigest: 'before' });
  const readBack = api.file('saved.md');
  assert.deepEqual(calls, ['/api/action', '/api/file?path=first.md']);
  release();
  await Promise.all([first, second, readBack]);
  assert.deepEqual(calls.slice(1), ['/api/file?path=first.md', '/api/file?path=second.md', '/api/file?path=saved.md']);
});
