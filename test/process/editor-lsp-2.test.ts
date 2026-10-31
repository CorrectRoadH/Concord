import { assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, join, resolve, fileURLToPath, pathToFileURL, test, Effect, Schema, readProjectConfig, writeProjectConfig, Position, Range, Location, Response, Diagnostics, file, reference, source, stepLine, testText, codeText, scratch, entry, cli, consumer, Client, run } from '../support/editor-fixture.js';

// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
// @name editor-disk-and-policy
test('packed editor C9/C17 rereads disk configuration, policy, deletion and rename without moving overlays', { timeout: 90000 }, () => run(async (c, root) => {
  c.open(file, source('new-step')); c.open('test/flow.ts', testText(reference));
  await c.diagnostic('test/flow.ts', 1);
  const policyPath = 'docs/concord-writing.json';
  const policy = JSON.parse(readFileSync(join(root, policyPath), 'utf8')) as Record<string, unknown>;
  c.open(policyPath, JSON.stringify({ ...policy, bannedTerms: [{ term: 'buffer', use: 'document', why: 'Precise noun' }] }), 1, 'json');
  const count = c.diagnostics.length;
  c.change(file, source('new-step'), 2);
  assert.ok((await c.diagnostic(file, 2, count)).diagnostics.some(item => item.code === 'bannedTerm'));
  c.close(policyPath);
  const configPath = join(root, 'concord.config.ts'), config = readProjectConfig(root);
  const pending = c.request('textDocument/hover', c.query('test/flow.ts', 1, 20));
  await new Promise<void>(resolve => setTimeout(resolve, 80));
  writeProjectConfig(root, { ...config, sourceRoots: [] });
  // A config byte edit invalidates the captured disk identity, even if semantically unrelated.
  writeFileSync(configPath, readFileSync(configPath, 'utf8') + '\n');
  assert.equal((await pending.response).error?.code, -32801);
  const current = await c.result('textDocument/hover', c.query('test/flow.ts', 1, 20)); assert.match(JSON.stringify(current), /new-step/u);
  const reconfigured = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/references', c.query(file, stepLine, 0, { includeDeclaration: false })));
  assert.ok(!reconfigured.some(item => item.uri === c.uri('src/flow.ts')));
  rmSync(join(root, file));
  c.send('workspace/didDeleteFiles', { files: [{ uri: c.uri(file) }] });
  c.change('test/flow.ts', testText(reference), 2);
  assert.ok((await c.diagnostic('test/flow.ts', 2)).diagnostics.some(item => item.code === 'EditorInputsIncomplete' && /MissingDiskDependency/u.test(item.message)));
  assert.match(JSON.stringify(await c.result('textDocument/hover', c.query('test/flow.ts', 1, 20))), /new-step/u);
  writeFileSync(join(root, file), source('new-step'));
  const renamed = 'docs/feature/sample/use-case/renamed.md'; renameSync(join(root, file), join(root, renamed));
  c.send('workspace/didRenameFiles', { files: [{ oldUri: c.uri(file), newUri: c.uri(renamed) }] });
  assert.equal((await c.request('textDocument/hover', c.query(file, stepLine)).response).error?.code, -32801);
  c.close(file);
  c.open(renamed, source('new-step'));
  c.change('test/flow.ts', testText(`${renamed}#new-step`), 3);
  const locations = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/definition', c.query('test/flow.ts', 1, 20)));
  assert.equal(locations[0]?.uri, c.uri(renamed));
  const newFile = 'test/newly-saved.ts';
  const newText = `// @use-case ${renamed}#new-step\n// @name newly-saved\n`;
  c.open(newFile, newText); writeFileSync(join(root, newFile), newText);
  c.send('textDocument/didSave', { textDocument: { uri: c.uri(newFile) }, text: newText });
  await c.result('textDocument/hover', c.query(newFile, 0, 20));
  rmSync(join(root, newFile)); c.send('workspace/didDeleteFiles', { files: [{ uri: c.uri(newFile) }] });
  c.change(newFile, newText, 2);
  assert.ok((await c.diagnostic(newFile, 2)).diagnostics.some(item => item.code === 'EditorInputsIncomplete'));
  assert.match(JSON.stringify(await c.result('textDocument/hover', c.query(newFile, 0, 20))), /new-step/u);
}));

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
