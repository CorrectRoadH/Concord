import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { Effect, Schema } from 'effect';
import { packConcord, installConcord } from './installed-package.js';
import { readProjectConfig, writeProjectConfig } from './support.js';

const Position = Schema.Struct({ line: Schema.Int, character: Schema.Int });
const Range = Schema.Struct({ start: Position, end: Position });
const Location = Schema.Struct({ uri: Schema.String, range: Range });
const Response = Schema.Struct({ jsonrpc: Schema.Literal('2.0'), id: Schema.Union([Schema.Int, Schema.String, Schema.Null]), result: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.Struct({ code: Schema.Int, message: Schema.String, data: Schema.optional(Schema.Unknown) })) });
const Diagnostics = Schema.Struct({ jsonrpc: Schema.Literal('2.0'), method: Schema.Literal('textDocument/publishDiagnostics'), params: Schema.Struct({ uri: Schema.String, version: Schema.Int, diagnostics: Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String, severity: Schema.Int, source: Schema.String, range: Range })) }) });
type Response = typeof Response.Type;
type Diagnostics = typeof Diagnostics.Type['params'];
const file = 'docs/feature/sample/use-case/flow.md';
const reference = `${file}#new-step`;
const source = (id: string) => `---\nformat: concord.document/v1\nid: flow\ntitle: Flow\ncreatedAt: 2026-10-21T00:00:00.000Z\nkind: use-case\nfeature: docs/feature/sample/README.md\n---\n\n# Flow\n\n1. Open 😀 buffer {#${id}}\n`;
const testText = (ref: string) => `// 😀 client buffer\n// @use-case ${ref}\n// @name editor-fixture\n`;
const codeText = (ref: string) => `// @concord-file\n// @concord-implements ${ref}\nexport const flow = 1;\n`;
let scratch: string, entry: string;
before(() => Effect.runPromise(Effect.sync(() => {
  scratch = mkdtempSync(join(tmpdir(), 'concord-editor-packed-'));
  const artifact = packConcord(scratch);
  const tool = join(scratch, 'tool'); mkdirSync(tool); writeFileSync(join(tool, 'package.json'), '{"private":true}');
  installConcord(tool, artifact);
  entry = join(tool, 'node_modules/concord-sdlc/dist/entry.js');
})));
after(() => Effect.runPromise(Effect.sync(() => { if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true }); })));

function cli(root: string, ...args: string[]) {
  return JSON.parse(execFileSync(process.execPath, [entry, '--root', root, '--json', '--fresh', ...args], { encoding: 'utf8', timeout: 20000 })) as unknown;
}
function consumer(): string {
  const root = mkdtempSync(join(scratch, 'consumer-'));
  execFileSync('git', ['init', '-q', root]);
  cli(root, 'init', '--test-root', 'test', '--source-root', 'src', '--no-default-pages');
  cli(root, 'feature', 'create', 'sample', '--title', 'Sample');
  cli(root, 'use-case', 'create', 'flow', '--title', 'Flow', '--feature', 'sample');
  for (const directory of ['src', 'test']) mkdirSync(join(root, directory));
  writeFileSync(join(root, file), source('old-step'));
  writeFileSync(join(root, 'test/flow.ts'), testText(`${file}#old-step`));
  writeFileSync(join(root, 'src/flow.ts'), codeText(`${file}#old-step`));
  return root;
}
class Client {
  readonly child: ChildProcessWithoutNullStreams;
  readonly diagnostics: Diagnostics[] = [];
  private readonly responses = new Map<number, Response>();
  private readonly waiters = new Set<() => void>();
  private buffer = Buffer.alloc(0);
  private sequence = 0;
  stderr = '';
  readonly closed: Promise<number | null>;
  constructor(readonly root: string) {
    this.child = spawn(process.execPath, [entry, '--root', root, 'lsp'], { cwd: root, stdio: 'pipe' });
    this.closed = new Promise(resolve => this.child.once('close', code => { resolve(code); this.changed(); }));
    this.child.stderr.on('data', (chunk: Buffer) => { this.stderr += chunk.toString(); });
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const end = this.buffer.indexOf('\r\n\r\n'); if (end < 0) return;
        const header = this.buffer.subarray(0, end).toString('ascii');
        assert.match(header, /^Content-Length: \d+$/u, 'stdout must contain framed JSON-RPC only');
        const size = Number(header.slice('Content-Length: '.length));
        if (this.buffer.length < end + 4 + size) return;
        const value: unknown = JSON.parse(this.buffer.subarray(end + 4, end + 4 + size).toString('utf8'));
        this.buffer = this.buffer.subarray(end + 4 + size);
        if (Schema.is(Diagnostics)(value)) this.diagnostics.push(Schema.decodeUnknownSync(Diagnostics)(value).params);
        else { const response = Schema.decodeUnknownSync(Response)(value); assert.equal(typeof response.id, 'number'); this.responses.set(Number(response.id), response); }
        this.changed();
      }
    });
  }
  private changed() { for (const waiter of this.waiters) waiter(); }
  async wait<A>(read: () => A | undefined, timeout = 12000): Promise<A> {
    const immediate = read(); if (immediate !== undefined) return immediate;
    return await new Promise<A>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(check); reject(new Error(`Editor response timeout; stderr: ${this.stderr}`)); }, timeout);
      const check = () => { const value = read(); if (value !== undefined) { clearTimeout(timer); this.waiters.delete(check); resolve(value); } };
      this.waiters.add(check); check();
    });
  }
  send(method: string, params?: unknown, id?: number) {
    const json = JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }), ...(id === undefined ? {} : { id }) });
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }
  request(method: string, params?: unknown) { const id = ++this.sequence; this.send(method, params, id); return { id, response: this.wait(() => this.responses.get(id)).catch(cause => { throw new Error(`${method}: ${String(cause)}`); }) }; }
  async result(method: string, params?: unknown): Promise<unknown> { const reply = await this.request(method, params).response; assert.equal(reply.error, undefined, JSON.stringify(reply)); return reply.result; }
  uri(path: string) { return pathToFileURL(join(this.root, path)).href; }
  open(path: string, text: string, version = 1, languageId = path.endsWith('.md') ? 'markdown' : 'typescript') { this.send('textDocument/didOpen', { textDocument: { uri: this.uri(path), languageId, version, text } }); }
  change(path: string, text: string, version: number) { this.send('textDocument/didChange', { textDocument: { uri: this.uri(path), version }, contentChanges: [{ text }] }); }
  close(path: string) { this.send('textDocument/didClose', { textDocument: { uri: this.uri(path) } }); }
  query(path: string, line: number, character = 0, context?: unknown) { return { textDocument: { uri: this.uri(path) }, position: { line, character }, ...(context === undefined ? {} : { context }) }; }
  diagnostic(path: string, version: number, from = 0) { return this.wait(() => this.diagnostics.slice(from).find(item => item.uri === this.uri(path) && item.version === version)); }
  async initialize() {
    const result = Schema.decodeUnknownSync(Schema.Struct({ capabilities: Schema.Record(Schema.String, Schema.Unknown), serverInfo: Schema.Unknown }))(await this.result('initialize', { processId: process.pid, rootUri: this.uri('.'), capabilities: { general: { positionEncodings: ['utf-16'] } } }));
    assert.equal(result.capabilities.positionEncoding, 'utf-16');
    for (const forbidden of ['documentFormattingProvider', 'codeActionProvider', 'executeCommandProvider']) assert.equal(result.capabilities[forbidden], undefined);
    this.send('initialized', {});
  }
  async stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    try { await this.result('shutdown'); this.send('exit'); assert.equal(await this.wait(() => this.child.exitCode === null ? undefined : this.child.exitCode, 6000), 0, this.stderr); await this.closed; }
    finally { if (this.child.exitCode === null && this.child.signalCode === null) { this.child.kill('SIGKILL'); await this.closed; } }
  }
  async eof() { this.child.stdin.end(); assert.equal(await Promise.race([this.closed, new Promise<number>((_, reject) => setTimeout(() => reject(new Error('EOF cleanup timeout')), 6000).unref())]), 0, this.stderr); }
}
const run = (body: (client: Client, root: string) => Promise<void>) => Effect.runPromise(Effect.tryPromise({ try: async () => {
  const root = consumer(), client = new Client(root);
  let failed = false;
  try { await client.initialize(); await body(client, root); }
  catch (cause) { failed = true; throw cause; }
  finally { try { await client.stop(); } catch (cause) { if (!failed) throw cause; } }
}, catch: cause => cause }));

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
  assert.deepEqual(definition, [{ uri: c.uri(file), range: { start: { line: 11, character: 0 }, end: { line: 11, character: 0 } } }]);
  const references = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/references', c.query(file, 11, 3, { includeDeclaration: false })));
  assert.deepEqual(references.map(item => [item.uri, item.range.start.line]).sort(), [[c.uri('src/flow.ts'), 1], [c.uri('test/flow.ts'), 1]].sort());
  const completion = Schema.decodeUnknownSync(Schema.Struct({ isIncomplete: Schema.Boolean, items: Schema.Array(Schema.Struct({ label: Schema.String, kind: Schema.Int, insertText: Schema.String, detail: Schema.String })) }))(await c.result('textDocument/completion', c.query('test/flow.ts', 1, 20)));
  assert.equal(completion.isIncomplete, false); assert.ok(completion.items.some(item => item.label === reference)); assert.ok(!completion.items.some(item => item.label.endsWith('#old-step')));
  const hover = Schema.decodeUnknownSync(Schema.Struct({ contents: Schema.Struct({ kind: Schema.String, value: Schema.String }) }))(await c.result('textDocument/hover', c.query('test/flow.ts', 1, 20)));
  assert.match(hover.contents.value, /Open 😀 buffer \{#new-step\}/u); assert.match(hover.contents.value, /observations are not provided/u);
  c.send('textDocument/didSave', { textDocument: { uri: c.uri(file) } });
  assert.match(JSON.stringify(await c.result('textDocument/hover', c.query('test/flow.ts', 1, 20))), /new-step/u);
  assert.match(readFileSync(join(root, file), 'utf8'), /old-step/u);
  c.open('test/new.ts', `// @use-case ${reference}\n// @name unsaved-new\n`);
  const newReferences = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/references', c.query(file, 11, 0, { includeDeclaration: true })));
  assert.ok(newReferences.some(item => item.uri === c.uri('test/new.ts'))); assert.ok(newReferences.some(item => item.uri === c.uri(file)));
  assert.equal(existsSync(join(root, 'test/new.ts')), false);
  c.open('src/nodes.ts', `// @concord-code\n// @concord-implements ${reference}\nexport function node(): number { return 1; }\n// @concord-begin\n// @concord-implements ${reference}\nconst region = 1;\n// @concord-end\n`);
  const nodeReferences = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/references', c.query(file, 11, 0, { includeDeclaration: false })));
  assert.deepEqual(nodeReferences.filter(item => item.uri === c.uri('src/nodes.ts')).map(item => item.range.start.line), [1, 4]);
  writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ id: 'python-editor', languageId: 'python', extensions: ['.py'], argv: [process.execPath, '-e', 'process.exit(99)'], cwd: '.', implementationFiles: ['src/flow.ts'], sourceFiles: [], profile: { version: 'fixture-v1', serverVersion: '1', commentPrefixes: ['#'], declarationKinds: [12], symbolShape: 'document-symbol', decorators: 'none', leadingComments: true, readiness: { kind: 'none' }, positionEncodings: ['utf-16'] } }] });
  c.open('src/flow.py', `# @concord-code\n# @concord-implements ${reference}\ndef flow():\n    return 1\n`, 1, 'python');
  const foreignReferences = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/references', c.query(file, 11, 0, { includeDeclaration: false })));
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
  const reconfigured = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/references', c.query(file, 11, 0, { includeDeclaration: false })));
  assert.ok(!reconfigured.some(item => item.uri === c.uri('src/flow.ts')));
  rmSync(join(root, file));
  c.send('workspace/didDeleteFiles', { files: [{ uri: c.uri(file) }] });
  c.change('test/flow.ts', testText(reference), 2);
  assert.ok((await c.diagnostic('test/flow.ts', 2)).diagnostics.some(item => item.code === 'EditorInputsIncomplete' && /MissingDiskDependency/u.test(item.message)));
  assert.match(JSON.stringify(await c.result('textDocument/hover', c.query('test/flow.ts', 1, 20))), /new-step/u);
  writeFileSync(join(root, file), source('new-step'));
  const renamed = 'docs/feature/sample/use-case/renamed.md'; renameSync(join(root, file), join(root, renamed));
  c.send('workspace/didRenameFiles', { files: [{ oldUri: c.uri(file), newUri: c.uri(renamed) }] });
  assert.equal((await c.request('textDocument/hover', c.query(file, 11)).response).error?.code, -32801);
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
  writeProjectConfig(root, { ...readProjectConfig(root), runner: { kind: 'command', argv: [process.execPath, 'must-not-run.ts'], sourceFiles: ['must-not-run.ts'], timeoutMs: 1000 }, languageServers: [{ id: 'python', languageId: 'python', extensions: ['.py'], argv: [process.execPath, 'must-not-run.ts'], cwd: '.', initializationOptions: {}, implementationFiles: ['must-not-run.ts'], sourceFiles: [], budgets: {}, profile: { version: 'fixture-v1', serverVersion: '1', commentPrefixes: ['#'], declarationKinds: [12], symbolShape: 'document-symbol', decorators: 'none', leadingComments: true, readiness: { kind: 'none' }, positionEncodings: ['utf-16'] } }] });
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
