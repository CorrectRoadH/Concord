import { assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, join, resolve, fileURLToPath, pathToFileURL, test, Effect, Schema, readProjectConfig, writeProjectConfig, Position, Range, Location, Response, Diagnostics, file, reference, source, stepLine, testText, codeText, scratch, entry, cli, consumer, Client, run } from '../support/editor-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
// @name editor-overlay-navigation
test('packed editor C7/C9 uses simultaneous unsaved steps, test and implementation markers in all navigation', { timeout: 90000 }, () => run(async (c, root) => {
  writeFileSync(join(root, 'test/oversized.ts'), Buffer.alloc(33 * 1024 * 1024, 'a'));
  const disk = Schema.decodeUnknownSync(Schema.Struct({ cases: Schema.Array(Schema.Struct({ file: Schema.String })) }))(cli(root, 'test', 'list'));
  assert.ok(disk.cases.some(item => item.file === 'test/flow.ts')); assert.ok(!disk.cases.some(item => item.file === 'test/oversized.ts'));
  rmSync(join(root, 'test/oversized.ts'));
  c.open(file, source('new-step')); c.open('test/flow.ts', testText(reference)); c.open('src/flow.ts', codeText(reference));
  assert.deepEqual((await c.diagnostic('test/flow.ts', 1)).diagnostics, []);
  assert.deepEqual((await c.diagnostic(file, 1)).diagnostics, []);
  const definition = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/definition', c.query('test/flow.ts', 1, 20)));
  assert.deepEqual(definition, [{ uri: c.uri(file), range: { start: { line: stepLine, character: 0 }, end: { line: stepLine, character: 0 } } }]);
  const references = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/references', c.query(file, stepLine, 3, { includeDeclaration: false })));
  assert.deepEqual(references.map(item => [item.uri, item.range.start.line]).sort(), [[c.uri('src/flow.ts'), 1], [c.uri('test/flow.ts'), 1]].sort());
  const completion = Schema.decodeUnknownSync(Schema.Struct({ isIncomplete: Schema.Boolean, items: Schema.Array(Schema.Struct({ label: Schema.String, kind: Schema.Int, insertText: Schema.String, detail: Schema.String })) }))(await c.result('textDocument/completion', c.query('test/flow.ts', 1, 20)));
  assert.equal(completion.isIncomplete, false); assert.ok(completion.items.some(item => item.label === reference)); assert.ok(!completion.items.some(item => item.label.endsWith('#old-step')));
  const hover = Schema.decodeUnknownSync(Schema.Struct({ contents: Schema.Struct({ kind: Schema.String, value: Schema.String }) }))(await c.result('textDocument/hover', c.query('test/flow.ts', 1, 20)));
  assert.match(hover.contents.value, /Open 😀 buffer \{#new-step\}/u); assert.match(hover.contents.value, /observations are not provided/u);
  c.send('textDocument/didSave', { textDocument: { uri: c.uri(file) } });
  assert.match(JSON.stringify(await c.result('textDocument/hover', c.query('test/flow.ts', 1, 20))), /new-step/u);
  assert.match(readFileSync(join(root, file), 'utf8'), /old-step/u);
  c.open('test/new.ts', `// @use-case ${reference}\n// @name unsaved-new\n`);
  const newReferences = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/references', c.query(file, stepLine, 0, { includeDeclaration: true })));
  assert.ok(newReferences.some(item => item.uri === c.uri('test/new.ts'))); assert.ok(newReferences.some(item => item.uri === c.uri(file)));
  assert.equal(existsSync(join(root, 'test/new.ts')), false);
  c.open('src/nodes.ts', `// @concord-code\n// @concord-implements ${reference}\nexport function node(): number { return 1; }\n// @concord-begin\n// @concord-implements ${reference}\nconst region = 1;\n// @concord-end\n`);
  const nodeReferences = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/references', c.query(file, stepLine, 0, { includeDeclaration: false })));
  assert.deepEqual(nodeReferences.filter(item => item.uri === c.uri('src/nodes.ts')).map(item => item.range.start.line), [1, 4]);
  writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ id: 'python-editor', languageId: 'python', extensions: ['.py'], argv: [process.execPath, '-e', 'process.exit(99)'], cwd: ".", initializationOptions: {}, budgets: {}, implementationFiles: ['src/flow.ts'], sourceFiles: [], profile: { version: 'fixture-v1', serverVersion: '1', commentPrefixes: ['#'], declarationKinds: [12], symbolShape: 'document-symbol', decorators: 'none', leadingComments: true, readiness: { kind: 'none' }, positionEncodings: ['utf-16'] } }] });
  c.open('src/flow.py', `# @concord-code\n# @concord-implements ${reference}\ndef flow():\n    return 1\n`, 1, 'python');
  const foreignReferences = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/references', c.query(file, stepLine, 0, { includeDeclaration: false })));
  assert.deepEqual(foreignReferences.filter(item => item.uri === c.uri('src/flow.py')).map(item => item.range.start.line), [1]);
  assert.deepEqual(Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/definition', c.query('src/flow.py', 1, 30))), definition);
  c.close('test/new.ts');
  const closed = await c.wait(() => c.diagnostics.filter(item => item.uri === c.uri('test/new.ts') && item.diagnostics.length === 0).at(-1)); assert.equal(closed.version, 1);
}));

// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
// @name editor-shutdown-pending-navigation
test('packed editor shutdown cancels pending navigation and clears diagnostics before acknowledging', { timeout: 60000 }, () => run(async c => {
  c.open(file, source('new-step')); c.open('test/flow.ts', testText(reference));
  await c.diagnostic('test/flow.ts', 1);
  const offset = c.diagnostics.length;
  const pending = c.request('textDocument/hover', c.query('test/flow.ts', 1, 20));
  assert.equal(await c.result('shutdown'), null);
  assert.equal((await pending.response).error?.code, -32800);
  assert.ok(c.diagnostics.slice(offset).some(item => item.uri === c.uri('test/flow.ts') && item.diagnostics.length === 0));
  const closed = await c.request('textDocument/hover', c.query('test/flow.ts', 1, 20)).response;
  assert.equal(closed.error?.code, -32002);
  c.send('exit');
  assert.equal(await c.closed, 0, c.stderr);
}));
