import { pollUntil } from '../support/support.ts';
import { assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, join, resolve, fileURLToPath, pathToFileURL, test, Effect, Schema, readProjectConfig, writeProjectConfig, Position, Range, Location, Response, Diagnostics, file, reference, source, stepLine, testText, codeText, scratch, entry, cli, consumer, Client, run } from '../support/editor-fixture.ts';
// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
// @name editor-protocol-and-interrupt
test('packed editor strictly rejects malformed parameters and oversized framing and ends tasks on SIGINT', { timeout: 60000 }, () => run(async (c, root) => {
  c.open(file, source('new-step')); c.open('test/flow.ts', testText(reference));
  await c.diagnostic('test/flow.ts', 1);
  const malformed = await c.request('textDocument/hover', { ...c.query('test/flow.ts', 1), execute: true }).response;
  assert.equal(malformed.error?.code, -32602);
  c.send('textDocument/didChange', { textDocument: { uri: c.uri('test/flow.ts'), version: 2 }, contentChanges: [{ text: testText(reference), unrecognized: true }] });
  assert.equal((await c.request('textDocument/hover', c.query('test/flow.ts', 1, 20)).response).error?.code, -32801);
  c.close('test/flow.ts'); c.open('test/flow.ts', testText(reference));
  c.send('textDocument/hover', c.query('test/flow.ts', 1, 20), 999);
  c.child.kill('SIGINT');
  await Promise.race([c.closed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SIGINT cleanup timeout')), 6000).unref())]);
  const framed = new Client(root);
  try {
    await framed.initialize();
    framed.child.stdin.write('Content-Length: 4194305\r\n\r\n');
    assert.equal(await framed.closed, 1);
    assert.match(framed.stderr, /EditorBudgetExceeded/u);
  } finally { await framed.stop(); }
}));
