// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md
import { spawn } from 'node:child_process';
import { existsSync, readSync, writeFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Effect, Predicate, Schema } from 'effect';

const Options = Schema.Struct({
  mode: Schema.optional(Schema.String), encoding: Schema.optional(Schema.Literals(['utf-16', 'utf-8', 'utf-32'])),
  auditPath: Schema.optional(Schema.String), mutate: Schema.optional(Schema.String), gatePath: Schema.optional(Schema.String),
});
const Message = Schema.Struct({ jsonrpc: Schema.Literal('2.0'), id: Schema.optional(Schema.Union([Schema.Number, Schema.String])), method: Schema.optional(Schema.String), params: Schema.optional(Schema.Unknown), result: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.Unknown) });
const Position = Schema.Struct({ line: Schema.Number, character: Schema.Number });
const Range = Schema.Struct({ start: Position, end: Position });
interface Symbol { name: string; kind: number; range: typeof Range.Type; selectionRange: typeof Range.Type; children?: Symbol[] }

Effect.runPromise(Effect.gen(function* () {
  let buffer = Buffer.alloc(0);
  let options: typeof Options.Type = {};
  const documents = new Map<string, string>();
  const audit: unknown[] = [];
  const send = (value: unknown): void => {
    const json = JSON.stringify(value);
    writeSync(1, `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  };
  const respond = (id: string | number, result: unknown): void => send({ jsonrpc: '2.0', id, result });
  const position = (line: number, character: number) => ({ line, character });
  const symbols = (uri: string): Symbol[] => {
    const lines = (documents.get(uri) ?? '').split('\n');
    const result: Symbol[] = [];
    let parent: Symbol | undefined;
    for (let line = 0; line < lines.length; line++) {
      const match = /^(\s*)(class|def) (\w+)/u.exec(lines[line]!);
      if (!match) continue;
      const start = match[1]!.length, kind = match[2] === 'class' ? 5 : start > 0 ? 6 : 12;
      let endLine = line;
      while (endLine + 1 < lines.length && (lines[endLine + 1]!.trim() === '' || /^\s/u.test(lines[endLine + 1]!) || /^#/u.test(lines[endLine + 1]!))) endLine++;
      const range = { start: position(line, start), end: position(endLine, lines[endLine]!.length) };
      const symbol: Symbol = { name: match[3]!, kind, range, selectionRange: { start: position(line, start + match[2]!.length + 1), end: position(line, start + match[2]!.length + 1 + match[3]!.length) } };
      if (kind === 6 && parent !== undefined) (parent.children ??= []).push(symbol);
      else { result.push(symbol); parent = kind === 5 ? symbol : undefined; }
    }
    return result;
  };
  const callItem = (uri: string, symbol: Symbol) => ({ uri, name: symbol.name, kind: symbol.kind, range: symbol.range, selectionRange: symbol.selectionRange });
  const allSymbols = (uri: string) => symbols(uri).flatMap(symbol => [symbol, ...symbol.children ?? []]);
  const handle = (input: unknown): void => {
    const message = Schema.decodeUnknownSync(Message, { onExcessProperty: 'error' })(input);
    audit.push({ pid: process.pid, method: message.method, id: message.id, result: message.result, error: message.error });
    if (options.auditPath) writeFileSync(options.auditPath, JSON.stringify(audit));
    if (message.id === undefined && message.method === undefined) return;
    switch (message.method) {
      case 'initialize': {
        const params = Schema.decodeUnknownSync(Schema.Struct({ initializationOptions: Schema.Unknown }), { onExcessProperty: 'ignore' })(message.params);
        options = Schema.decodeUnknownSync(Options, { onExcessProperty: 'error' })(params.initializationOptions);
        if (options.auditPath) writeFileSync(options.auditPath, JSON.stringify(audit));
        if (options.mode === 'timeout') return;
        if (options.mode === 'invalid-result') { respond(message.id!, null); return; }
        if (options.gatePath) {
          const deadline = Date.now() + 20000;
          while (!existsSync(options.gatePath) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        }
        if (options.mode === 'invalid-message') { writeSync(1, 'Content-Length: 3\r\n\r\nxxx'); return; }
        if (options.mode === 'output-limit') { writeSync(2, 'x'.repeat(65536)); return; }
        respond(message.id!, { capabilities: { textDocumentSync: { openClose: true, change: 1 }, documentSymbolProvider: options.mode !== 'no-capability', callHierarchyProvider: options.mode !== 'no-capability', positionEncoding: options.encoding ?? 'utf-16' }, serverInfo: { name: 'fixture', version: '1.0.0' } });
        break;
      }
      case 'initialized':
        send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'index', value: { kind: 'end' } } });
        if (options.mode === 'apply-edit') {
          send({ jsonrpc: '2.0', id: 'edit', method: 'workspace/applyEdit', params: { edit: { changes: {} } } });
          send({ jsonrpc: '2.0', id: 'execute', method: 'workspace/executeCommand', params: { command: 'danger' } });
        }
        break;
      case 'textDocument/didOpen': {
        const params = Schema.decodeUnknownSync(Schema.Struct({ textDocument: Schema.Struct({ uri: Schema.String, text: Schema.String, languageId: Schema.String, version: Schema.Number }) }))(message.params);
        documents.set(params.textDocument.uri, params.textDocument.text); break;
      }
      case 'textDocument/documentSymbol': {
        const params = Schema.decodeUnknownSync(Schema.Struct({ textDocument: Schema.Struct({ uri: Schema.String }) }))(message.params);
        const uri = params.textDocument.uri;
        if (options.mutate) { writeFileSync(fileURLToPath(new URL(options.mutate, uri)), '# server mutation\n'); }
        const value = symbols(uri);
        if (options.mode === 'flat') respond(message.id!, allSymbols(uri).map(symbol => ({ name: symbol.name, kind: symbol.kind, location: { uri, range: symbol.range } })));
        else if (options.mode === 'null') respond(message.id!, null);
        else if (options.mode === 'bad-range') respond(message.id!, value.map(symbol => ({ ...symbol, selectionRange: { start: position(9999, 0), end: position(9999, 1) } })));
        else respond(message.id!, value);
        break;
      }
      case 'textDocument/prepareCallHierarchy': {
        const params = Schema.decodeUnknownSync(Schema.Struct({ textDocument: Schema.Struct({ uri: Schema.String }), position: Position }))(message.params);
        const symbol = allSymbols(params.textDocument.uri).find(symbol => symbol.selectionRange.start.line === params.position.line);
        respond(message.id!, symbol ? [callItem(params.textDocument.uri, symbol)] : null); break;
      }
      case 'callHierarchy/outgoingCalls': {
        const params = Schema.decodeUnknownSync(Schema.Struct({ item: Schema.Record(Schema.String, Schema.Unknown) }))(message.params);
        const item = params.item;
        const target = item.name === 'test_sample' ? 'helper' : item.name === 'helper' ? 'implementation' : undefined;
        const uri = target === 'helper' ? [...documents.keys()].find(uri => uri.endsWith('/test/helper.py')) : [...documents.keys()].find(uri => uri.endsWith('/src/sample.py'));
        const symbol = uri ? allSymbols(uri).find(symbol => symbol.name === target) : undefined;
        if (options.mode === 'unsafe-uri') respond(message.id!, [{ to: { ...item, uri: 'https://example.invalid/source' }, fromRanges: [] }]);
        else if (options.mode === 'external-uri') respond(message.id!, [{ to: { ...item, uri: 'file:///concord-external/source.py' }, fromRanges: [] }]);
        else respond(message.id!, uri && symbol ? [{ to: callItem(uri, symbol), fromRanges: [] }] : []);
        break;
      }
      case 'shutdown': respond(message.id!, null); break;
      case 'exit':
        if (options.mode === 'residual') {
          const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
          audit.push({ pid: process.pid, residualPid: child.pid });
          if (options.auditPath) writeFileSync(options.auditPath, JSON.stringify(audit));
        }
        process.exit(0);
    }
  };
  // Use fd reads/writes so the fixture also runs under restricted stdio environments.
  for (;;) {
    const chunk = Buffer.alloc(65536);
    const length = yield* Effect.try({ try: () => readSync(0, chunk), catch: cause => cause }).pipe(Effect.catch(cause => {
      if (Predicate.isObject(cause) && cause.code === 'EAGAIN') return Effect.sleep(5).pipe(Effect.as(-1));
      return Effect.fail(cause);
    }));
    if (length === 0) return;
    if (length < 0) continue;
    buffer = Buffer.concat([buffer, chunk.subarray(0, length)]);
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n'); if (end < 0) break;
      const match = /Content-Length:\s*(\d+)/iu.exec(buffer.subarray(0, end).toString()); if (!match) throw new Error('invalid fixture input');
      const size = Number(match[1]); if (buffer.length < end + 4 + size) break;
      const input: unknown = JSON.parse(buffer.subarray(end + 4, end + 4 + size).toString()); buffer = buffer.subarray(end + 4 + size);
      if (Predicate.isObject(input)) yield* Effect.sync(() => handle(input));
    }
  }
}));
