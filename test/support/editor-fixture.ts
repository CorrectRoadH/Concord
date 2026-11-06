import { LocalRepository } from './repository.ts';
import { createConsumer } from './consumer.ts';
import { createDocument } from './operations.ts';
import { sourceCli } from './source-consumer.ts';
import { renderOwnerFixture } from '../support/owner-fixture.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { Effect, Schema } from 'effect';
import { sourceRoot, prepareSourceConsumer } from '../support/source-consumer.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

const Position = Schema.Struct({ line: Schema.Int, character: Schema.Int });
const Range = Schema.Struct({ start: Position, end: Position });
const Location = Schema.Struct({ uri: Schema.String, range: Range });
const Response = Schema.Struct({ jsonrpc: Schema.Literal('2.0'), id: Schema.Union([Schema.Int, Schema.String, Schema.Null]), result: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.Struct({ code: Schema.Int, message: Schema.String, data: Schema.optional(Schema.Unknown) })) });
const Diagnostics = Schema.Struct({ jsonrpc: Schema.Literal('2.0'), method: Schema.Literal('textDocument/publishDiagnostics'), params: Schema.Struct({ uri: Schema.String, version: Schema.Int, diagnostics: Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String, severity: Schema.Int, source: Schema.String, range: Range })) }) });
type Response = typeof Response.Type;
type Diagnostics = typeof Diagnostics.Type['params'];
const file = 'docs/feature/sample/use-case/flow.md';
const reference = `${file}#new-step`;
const source = (id: string) => renderOwnerFixture({ id: 'flow', title: 'Flow', kind: 'use-case', feature: 'docs/feature/sample/README.md' }, `# Flow\n\n1. Open 😀 buffer {#${id}}\n`);
const stepLine = source('new-step').split('\n').findIndex(line => line.startsWith('1. '));
const testText = (ref: string) => `// 😀 client buffer\n// @use-case ${ref}\n// @name editor-fixture\n`;
const codeText = (ref: string) => `// @concord-file\n// @concord-implements ${ref}\nexport const flow = 1;\n`;
let scratch: string, entry: string;
before(() => Effect.runPromise(Effect.sync(() => {
  scratch = mkdtempSync(join(tmpdir(), 'concord-editor-packed-'));

  entry = sourceCli();
})));
after(() => Effect.runPromise(Effect.sync(() => { if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true }); })));

function cli(root: string, ...args: string[]) {
  return JSON.parse(execFileSync(process.execPath, [entry, '--root', root, '--json', '--fresh', ...args], { encoding: 'utf8', timeout: 20000 })) as unknown;
}
function consumer(): string {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: ['test'], sourceRoots: ['src'] });
  const repo = new LocalRepository(root);
  try {
    createDocument(repo, 'feature', { id: 'sample', title: 'Sample' });
    createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'sample' });
  } finally { repo.close(); }
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
  readonly root: string;
  constructor(root: string, argv = [entry, '--root', root, 'lsp'], env: NodeJS.ProcessEnv = process.env) {
    this.root = root;
    this.child = spawn(process.execPath, argv, { cwd: root, stdio: 'pipe', env });
    this.closed = new Promise(resolve => this.child.once('close', code => { resolve(code); this.changed(); }));
    this.child.stderr.on('data', (chunk: Buffer) => { this.stderr += chunk.toString(); this.changed(); });
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
    const result = Schema.decodeUnknownSync(Schema.Struct({ capabilities: Schema.Record(Schema.String, Schema.Unknown), serverInfo: Schema.Unknown }))(await this.result('initialize', { processId: process.pid, rootUri: this.uri("."), capabilities: { general: { positionEncodings: ['utf-16'] } } }));
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
const run = (body: (client: Client, root: string) => Promise<void>, gateWorkers = false) => Effect.runPromise(Effect.tryPromise({ try: async () => {
  const root = consumer(), client = gateWorkers ? new Client(root, undefined, { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${new URL('../fixtures/editor-job-gate.ts', import.meta.url).href}` }) : new Client(root);
  let failed = false;
  try { await client.initialize(); await body(client, root); }
  catch (cause) { failed = true; throw cause; }
  finally { try { await client.stop(); } catch (cause) { if (!failed) throw cause; } }
}, catch: cause => cause }));

export { assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, join, resolve, fileURLToPath, pathToFileURL, test, Effect, Schema, readProjectConfig, writeProjectConfig, Position, Range, Location, Response, Diagnostics, file, reference, source, stepLine, testText, codeText, scratch, entry, cli, consumer, Client, run };
