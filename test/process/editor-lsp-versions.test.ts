// 跨进程保证：服务与 IPC——真实编辑器stdio交互中取消或版本变更使在途导航返回取消及过期错误。
import { assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, join, resolve, fileURLToPath, pathToFileURL, test, Effect, Schema, readProjectConfig, writeProjectConfig, Position, Range, Location, Response, Diagnostics, file, reference, source, stepLine, testText, codeText, scratch, entry, cli, consumer, Client, run } from '../support/editor-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
// @name editor-incremental-and-stale
test('packed editor C8/C17 applies UTF-16 changes sequentially and rejects rollback, cancellation and stale tasks', { timeout: 90000 }, () => run(async c => {
  c.open(file, source('new-step')); c.open('test/flow.ts', testText(reference));
  await c.diagnostic('test/flow.ts', 1);
  // Emoji occupies two UTF-16 units. The second change uses the first change's text.
  c.send('textDocument/didChange', { textDocument: { uri: c.uri('test/flow.ts'), version: 2 }, contentChanges: [
    { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } }, rangeLength: 2, text: '😀😀' },
    { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 7 } }, rangeLength: 2, text: '' },
  ] });
  assert.deepEqual((await c.diagnostic('test/flow.ts', 2)).diagnostics, []);
  const stale = c.request('textDocument/hover', c.query('test/flow.ts', 1, 20));
  c.change('test/flow.ts', testText(`${file}#absent`), 3);
  assert.equal((await stale.response).error?.code, -32801);
  const missing = await c.diagnostic('test/flow.ts', 3); assert.ok(missing.diagnostics.some(item => item.code === 'StepNotFound'));
  const cancelled = c.request('textDocument/definition', c.query('test/flow.ts', 1, 20)); c.send('$/cancelRequest', { id: cancelled.id });
  assert.equal((await cancelled.response).error?.code, -32800);
  assert.ok(c.diagnostics.filter(item => item.uri === c.uri('test/flow.ts')).at(-1)?.diagnostics.some(item => item.code === 'StepNotFound'));
  c.change('test/flow.ts', testText(reference), 2);
  assert.equal((await c.request('textDocument/hover', c.query('test/flow.ts', 1, 20)).response).error?.code, -32801);
  c.change('test/flow.ts', testText(reference), 4);
  assert.equal((await c.request('textDocument/hover', c.query('test/flow.ts', 1, 20)).response).error?.code, -32801);
  c.close('test/flow.ts'); c.open('test/flow.ts', testText(reference), 1);
  assert.ok((await c.result('textDocument/definition', c.query('test/flow.ts', 1, 20))) !== null);
  c.send('textDocument/didChange', { textDocument: { uri: c.uri('test/flow.ts'), version: 2 }, contentChanges: [{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } }, text: '' }] });
  assert.equal((await c.request('textDocument/hover', c.query('test/flow.ts', 1, 20)).response).error?.code, -32801);
  c.close('test/flow.ts'); c.open('test/flow.ts', testText(reference));
  const closing = c.request('textDocument/hover', c.query('test/flow.ts', 1, 20)); c.close('test/flow.ts'); c.open('test/flow.ts', testText(`${file}#absent`));
  assert.equal((await closing.response).error?.code, -32801);
  c.send('textDocument/didSave', { textDocument: { uri: c.uri('test/flow.ts') }, text: 'disk cannot replace overlay' });
  assert.equal((await c.request('textDocument/hover', c.query('test/flow.ts', 1, 20)).response).error?.code, -32801);
}));
