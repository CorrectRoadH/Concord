// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/use-editor-service.md#文件与资源边界
import { Schema } from 'effect';
import { ConcordError, Nat, Text, decode } from './shared.js';
import { PositionSchema, RangeSchema, positionOffset, validRange } from './lsp-symbols.js';

export { positionOffset, validRange };
export const editorLimits = { message: 4 * 1024 * 1024, messages: 100000, document: 2 * 1024 * 1024, overlay: 16 * 1024 * 1024, documents: 64, tasks: 8, output: 8 * 1024 * 1024, files: 10000, input: 64 * 1024 * 1024, timeout: 30000 } as const;
export const RpcId = Schema.Union([Schema.String, Schema.Int]);
export type RpcId = typeof RpcId.Type;
export const Envelope = Schema.Struct({ jsonrpc: Schema.Literal('2.0'), id: Schema.optional(RpcId), method: Text, params: Schema.optional(Schema.Unknown) });
const document = Schema.Struct({ uri: Text });
const version = Schema.Int.check(Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 }));
export const Open = Schema.Struct({ textDocument: Schema.Struct({ uri: Text, languageId: Text, version, text: Schema.String }) });
export const Change = Schema.Struct({ textDocument: Schema.Struct({ uri: Text, version }), contentChanges: Schema.NonEmptyArray(Schema.Struct({ range: Schema.optional(RangeSchema), rangeLength: Schema.optional(Nat), text: Schema.String })) });
export const Save = Schema.Struct({ textDocument: document, text: Schema.optional(Schema.String) });
export const Close = Schema.Struct({ textDocument: document });
export const Query = Schema.Struct({ textDocument: document, position: PositionSchema, context: Schema.optional(Schema.Union([Schema.Struct({ includeDeclaration: Schema.Boolean }), Schema.Struct({ triggerKind: Schema.Int, triggerCharacter: Schema.optional(Schema.String) })])), workDoneToken: Schema.optional(RpcId), partialResultToken: Schema.optional(RpcId) });
export const References = Schema.Struct({ textDocument: document, position: PositionSchema, context: Schema.Struct({ includeDeclaration: Schema.Boolean }), workDoneToken: Schema.optional(RpcId), partialResultToken: Schema.optional(RpcId) });
export const Completion = Schema.Struct({ textDocument: document, position: PositionSchema, context: Schema.optional(Schema.Struct({ triggerKind: Schema.Int, triggerCharacter: Schema.optional(Schema.String) })), workDoneToken: Schema.optional(RpcId), partialResultToken: Schema.optional(RpcId) });
export const Initialize = Schema.Struct({ processId: Schema.NullOr(Schema.Int), clientInfo: Schema.optional(Schema.Struct({ name: Text, version: Schema.optional(Schema.String) })), locale: Schema.optional(Schema.String), rootPath: Schema.optional(Schema.NullOr(Schema.String)), rootUri: Schema.NullOr(Schema.String), capabilities: Schema.Record(Schema.String, Schema.Unknown), initializationOptions: Schema.optional(Schema.Unknown), trace: Schema.optional(Schema.Literals(['off', 'messages', 'verbose'])), workspaceFolders: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ uri: Text, name: Text })))), workDoneToken: Schema.optional(RpcId) });
export const Empty = Schema.Struct({});
export const Cancel = Schema.Struct({ id: RpcId });
export const Deleted = Schema.Struct({ files: Schema.Array(Schema.Struct({ uri: Text })) });
export const Renamed = Schema.Struct({ files: Schema.Array(Schema.Struct({ oldUri: Text, newUri: Text })) });
export const Watched = Schema.Struct({ changes: Schema.Array(Schema.Struct({ uri: Text, type: Schema.Literals([1, 2, 3]) })) });

export const Overlay = Schema.Struct({ uri: Text, path: Text, languageId: Text, version, opened: Nat, text: Schema.String, valid: Schema.Boolean, existed: Schema.Boolean });
export type Overlay = typeof Overlay.Type;
export const Job = Schema.Struct({ root: Text, generation: Nat, config: Text, revision: Schema.String, overlays: Schema.Array(Overlay), method: Schema.String, params: Schema.optional(Query) });
export type Job = typeof Job.Type;
const diagnostic = Schema.Struct({ range: RangeSchema, severity: Schema.Int, code: Text, source: Schema.Literal('concord'), message: Schema.String });
export const Computed = Schema.Struct({
  generation: Nat, revision: Schema.String, config: Text, complete: Schema.Boolean, gaps: Schema.Array(Text), value: Schema.Unknown,
  diagnostics: Schema.Array(Schema.Struct({ uri: Text, version, diagnostics: Schema.Array(diagnostic) })),
  reads: Schema.Array(Schema.Tuple([Text, Schema.NullOr(Text), Schema.NullOr(Text)])),
  listings: Schema.Array(Schema.Struct({ prefix: Text, source: Schema.Boolean, paths: Schema.Array(Text) })),
});
export type Computed = typeof Computed.Type;
export const WorkerReply = Schema.Union([Schema.Struct({ ok: Schema.Literal(true), result: Computed }), Schema.Struct({ ok: Schema.Literal(false), code: Text, message: Schema.String })]);

/** Byte framing has its own bound, independent of JSON text or document budgets. */
export class EditorFrames {
  private buffer = Buffer.alloc(0);
  private length: number | undefined;
  private messages = 0;
  receive(chunk: Buffer, consume: (value: unknown) => void): void {
    if (this.buffer.length + chunk.length > editorLimits.message * 2) throw new ConcordError('EditorBudgetExceeded', 'Input buffer limit');
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.length === undefined) {
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end < 0) { if (this.buffer.length > 8192) throw new ConcordError('InvalidEditorFrame', 'Header limit'); return; }
        if (end > 8192) throw new ConcordError('InvalidEditorFrame', 'Header limit');
        const headers = this.buffer.subarray(0, end).toString('ascii').split('\r\n');
        const lengths = headers.filter(header => /^Content-Length:/iu.test(header));
        if (lengths.length !== 1 || !/^Content-Length:\s*[0-9]+\s*$/iu.test(lengths[0]!)) throw new ConcordError('InvalidEditorFrame', 'Invalid Content-Length');
        this.length = Number(lengths[0]!.split(':')[1]!.trim());
        if (!Number.isSafeInteger(this.length) || this.length < 1 || this.length > editorLimits.message) throw new ConcordError('EditorBudgetExceeded', 'Message limit');
        this.buffer = this.buffer.subarray(end + 4);
      }
      if (this.buffer.length < this.length) return;
      const bytes = this.buffer.subarray(0, this.length);
      this.buffer = this.buffer.subarray(this.length); this.length = undefined;
      if (++this.messages > editorLimits.messages) throw new ConcordError('EditorBudgetExceeded', 'Session message limit');
      try { consume(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
      catch (cause) { if (cause instanceof ConcordError) throw cause; throw new ConcordError('InvalidEditorFrame', 'Invalid UTF-8 or JSON'); }
    }
  }
  end(): void { if (this.buffer.length || this.length !== undefined) throw new ConcordError('InvalidEditorFrame', 'Truncated message at EOF'); }
  clear(): void { this.buffer = Buffer.alloc(0); this.length = undefined; }
}

export function changedText(before: string, changes: typeof Change.Type['contentChanges']): string {
  let text = before;
  for (const change of changes) {
    if (change.range === undefined) {
      if (change.rangeLength !== undefined) throw new ConcordError('InvalidDocumentChange', 'rangeLength requires a range');
      text = change.text;
    } else {
      const [start, end] = validRange(text, change.range, 'utf-16');
      if (change.rangeLength !== undefined && change.rangeLength !== end - start) throw new ConcordError('InvalidDocumentChange', 'rangeLength differs from UTF-16 range');
      text = text.slice(0, start) + change.text + text.slice(end);
    }
    if (Buffer.byteLength(text) > editorLimits.document) throw new ConcordError('EditorBudgetExceeded', 'Document limit');
  }
  return text;
}

export function workerReply(value: unknown) { return decode(WorkerReply, value, 'editor worker reply'); }
