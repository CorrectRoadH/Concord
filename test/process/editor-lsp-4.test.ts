import { pollUntil } from '../support/support.js';
import { assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, join, resolve, fileURLToPath, pathToFileURL, test, Effect, Schema, readProjectConfig, writeProjectConfig, Position, Range, Location, Response, Diagnostics, file, reference, source, stepLine, testText, codeText, scratch, entry, cli, consumer, Client, run } from '../support/editor-fixture.js';
// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
// @name editor-read-only-and-eof
test('packed editor C17/C18 rejects unsafe input and edits, never launches configured commands, and cleans up EOF', { timeout: 90000 }, () => run(async (c, root) => {
  writeFileSync(join(root, 'must-not-run.ts'), `import { writeFileSync } from 'node:fs';\nconst marker: string = 'external-process-started';\nwriteFileSync(marker, 'unexpected');\n`);
  writeProjectConfig(root, { ...readProjectConfig(root), runner: { kind: 'command', argv: [process.execPath, 'must-not-run.ts'], sourceFiles: ['must-not-run.ts'], timeoutMs: 1000 }, languageServers: [{ id: 'python', languageId: 'python', extensions: ['.py'], argv: [process.execPath, 'must-not-run.ts'], cwd: ".", initializationOptions: {}, implementationFiles: ['must-not-run.ts'], sourceFiles: [], budgets: {}, profile: { version: 'fixture-v1', serverVersion: '1', commentPrefixes: ['#'], declarationKinds: [12], symbolShape: 'document-symbol', decorators: 'none', leadingComments: true, readiness: { kind: 'none' }, positionEncodings: ['utf-16'] } }] });
  writeFileSync(join(root, 'src/flow.py'), `# @concord-file\n# @concord-implements ${reference}\n`);
  c.open(file, source('new-step')); c.open('test/flow.ts', testText(reference));
  await c.diagnostic(file, 1);
  for (const method of ['textDocument/formatting', 'textDocument/codeAction', 'workspace/executeCommand', 'workspace/willRenameFiles', 'workspace/applyEdit']) assert.equal((await c.request(method, {}).response).error?.code, -32601);
  for (const uri of ['https://example.invalid/flow.ts', pathToFileURL(join(root, '../outside.ts')).href, c.uri('test/flow.ts') + '?secret=1', c.uri('.git/config')]) {
    c.send('textDocument/didOpen', { textDocument: { uri, version: 1, languageId: 'typescript', text: testText(reference) } });
    assert.equal((await c.request('textDocument/hover', { textDocument: { uri }, position: { line: 0, character: 0 } }).response).error?.code, -32602);
  }
  symlinkSync(join(root, '../outside.ts'), join(root, 'test/link.ts'));
  const linked = c.uri('test/link.ts'); c.send('textDocument/didOpen', { textDocument: { uri: linked, version: 1, languageId: 'typescript', text: '' } });
  assert.equal((await c.request('textDocument/hover', { textDocument: { uri: linked }, position: { line: 0, character: 0 } }).response).error?.code, -32602);
  rmSync(join(root, 'test/link.ts'));
  renameSync(join(root, 'test/flow.ts'), join(root, 'test/flow-held.ts'));
  symlinkSync(join(root, 'test/flow-held.ts'), join(root, 'test/flow.ts'));
  assert.equal((await c.request('textDocument/definition', c.query('test/flow.ts', 1, 20)).response).error?.code, -32602);
  rmSync(join(root, 'test/flow.ts')); renameSync(join(root, 'test/flow-held.ts'), join(root, 'test/flow.ts'));
  const before = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' });
  const privateFiles = readdirSync(join(root, '.git/concord'), { recursive: true });
  c.open('test/never-written.ts', testText(reference));
  await c.result('textDocument/hover', c.query('test/flow.ts', 1, 20));
  assert.equal(existsSync(join(root, 'test/never-written.ts')), false);
  assert.deepEqual(readdirSync(join(root, '.git/concord'), { recursive: true }), privateFiles);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }), before);
  assert.equal(existsSync(join(root, 'external-process-started')), false);
  c.send('textDocument/hover', c.query('test/flow.ts', 1, 20), 999);
  await c.eof();
  assert.equal(existsSync(join(root, '.git/concord/trace/publication.lease')), false);
}));
