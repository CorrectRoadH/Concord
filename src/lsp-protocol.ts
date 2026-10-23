// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md#配置与结果
import { Effect, Predicate, Schema } from 'effect';
import { ConcordError, decode } from './shared.js';
import type { AnalysisBudgets } from './language-server-config.js';

const id = Schema.Union([Schema.Int, Schema.String]);
const response = Schema.Struct({ jsonrpc: Schema.Literal('2.0'), id, result: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.Struct({ code: Schema.Int, message: Schema.String, data: Schema.optional(Schema.Unknown) })) });
const request = Schema.Struct({ jsonrpc: Schema.Literal('2.0'), id: Schema.optional(id), method: Schema.String, params: Schema.optional(Schema.Unknown) });
const progress = Schema.Struct({ token: Schema.Union([Schema.String, Schema.Int]), value: Schema.Struct({ kind: Schema.String, title: Schema.optional(Schema.String), message: Schema.optional(Schema.String), cancellable: Schema.optional(Schema.Boolean), percentage: Schema.optional(Schema.Number) }) });
type Pending = { readonly resolve: (value: unknown) => void; readonly reject: (error: ConcordError) => void; readonly timer: ReturnType<typeof setTimeout> };

/** Bounded framing; no server-requested edit, execution, credentials or UI capability. */
export class LspConnection {
  private buffer: Buffer = Buffer.alloc(0);
  private length: number | undefined;
  private writer: ((bytes: string) => void) | undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private messages = 0;
  private failed: ConcordError | undefined;
  private readyResolve!: () => void;
  private readonly ready = new Promise<void>(resolve => { this.readyResolve = resolve; });
  readonly endedProgress = new Set<string>();
  readonly gaps = new Set<string>();
  constructor(readonly budgets: AnalysisBudgets) {}
  connect(write: (bytes: string) => void): void { this.writer = write; this.readyResolve(); }
  failure(code: string, message: string): void {
    this.failed ??= new ConcordError(code, message);
    for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(this.failed); }
    this.pending.clear();
  }
  notify(method: string, params?: unknown): void { this.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }); }
  private send(value: unknown): void {
    if (this.writer === undefined) throw new ConcordError('LanguageServerFailed', 'Language server input is unavailable');
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > this.budgets.messageBytes) throw new ConcordError('AnalysisBudgetExceeded', 'Outgoing message exceeds messageBytes');
    this.writer(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }
  request(method: string, params?: unknown): Effect.Effect<unknown, ConcordError> {
    return Effect.tryPromise({ try: async signal => {
      await this.ready;
      if (this.failed !== undefined) throw this.failed;
      if (this.nextId >= this.budgets.requests) throw new ConcordError('AnalysisBudgetExceeded', 'RequestLimit');
      const requestId = ++this.nextId;
      return await new Promise<unknown>((resolve, reject) => {
        const abort = () => {
          if (!this.pending.has(requestId)) return;
          try { this.notify('$/cancelRequest', { id: requestId }); } catch { /* Process cleanup follows cancellation. */ }
          clearTimeout(this.pending.get(requestId)!.timer); this.pending.delete(requestId);
          reject(new ConcordError('AnalysisCancelled', 'Analysis request was cancelled'));
        };
        const settle = <T>(callback: (value: T) => void) => (value: T) => { signal.removeEventListener('abort', abort); callback(value); };
        const timer = setTimeout(() => {
          try { this.notify('$/cancelRequest', { id: requestId }); } catch { /* Process cleanup follows timeout. */ }
          this.pending.delete(requestId);
          settle(reject)(new ConcordError('AnalysisBudgetExceeded', `Request timed out: ${method}`));
        }, this.budgets.requestMs);
        this.pending.set(requestId, { resolve: settle(resolve), reject: settle(reject), timer });
        signal.addEventListener('abort', abort, { once: true });
        try { this.send({ jsonrpc: '2.0', id: requestId, method, ...(params === undefined ? {} : { params }) }); }
        catch (cause) { clearTimeout(timer); this.pending.delete(requestId); settle(reject)(cause); }
      });
    }, catch: cause => cause instanceof ConcordError ? cause : new ConcordError('LanguageServerFailed', 'Language server transport failed') });
  }
  cancel(): void {
    for (const requestId of this.pending.keys()) try { this.notify('$/cancelRequest', { id: requestId }); } catch { /* Scope still owns the process. */ }
    this.failure('AnalysisCancelled', 'Analysis session ended');
  }
  receive(chunk: Buffer): void {
    if (this.failed !== undefined) return;
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        if (this.length === undefined) {
          const end = this.buffer.indexOf('\r\n\r\n');
          if (end < 0) { if (this.buffer.length > 8192) throw new ConcordError('AnalysisBudgetExceeded', 'LSP header exceeds 8192 bytes'); return; }
          if (end > 8192) throw new ConcordError('AnalysisBudgetExceeded', 'LSP header exceeds 8192 bytes');
          const headers = this.buffer.subarray(0, end).toString('ascii').split('\r\n');
          const lengths = headers.filter(header => /^Content-Length:/iu.test(header));
          if (lengths.length !== 1 || !/^Content-Length:\s*[0-9]+\s*$/iu.test(lengths[0]!)) throw new ConcordError('LanguageServerFailed', 'Invalid LSP Content-Length');
          this.length = Number(lengths[0]!.split(':')[1]!.trim());
          if (!Number.isSafeInteger(this.length) || this.length < 1 || this.length > this.budgets.messageBytes) throw new ConcordError('AnalysisBudgetExceeded', 'LSP message exceeds messageBytes');
          this.buffer = this.buffer.subarray(end + 4);
        }
        if (this.buffer.length < this.length) return;
        const bytes = this.buffer.subarray(0, this.length);
        this.buffer = this.buffer.subarray(this.length); this.length = undefined;
        if (++this.messages > this.budgets.messages) throw new ConcordError('AnalysisBudgetExceeded', 'MessageLimit');
        const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        this.dispatch(JSON.parse(json));
      }
    } catch (cause) { this.failure(cause instanceof ConcordError && cause.code === 'AnalysisBudgetExceeded' ? cause.code : 'LanguageServerFailed', 'Invalid or over-budget language server message'); }
  }
  private dispatch(value: unknown): void {
    if (!Predicate.isObject(value)) throw new ConcordError('LanguageServerFailed', 'JSON-RPC message must be an object');
    if ('method' in value) {
      const message = decode(request, value, 'server request');
      if (message.id === undefined) {
        if (message.method === '$/progress') {
          const update = decode(progress, message.params, 'progress notification');
          if (update.value.kind === 'end') this.endedProgress.add(String(update.token));
        } else if (message.method === '$/partialResult') this.gaps.add('PartialResult');
        return;
      }
      if (message.method === 'workspace/applyEdit') {
        decode(Schema.Struct({ label: Schema.optional(Schema.String), edit: Schema.Record(Schema.String, Schema.Unknown) }), message.params, 'applyEdit');
        this.send({ jsonrpc: '2.0', id: message.id, result: { applied: false, failureReason: 'Concord analysis is read-only' } });
      } else if (message.method === 'window/workDoneProgress/create') {
        decode(Schema.Struct({ token: id }), message.params, 'progress/create');
        this.send({ jsonrpc: '2.0', id: message.id, result: null });
      } else if (message.method === 'workspace/configuration') {
        const params = decode(Schema.Struct({ items: Schema.Array(Schema.Struct({ scopeUri: Schema.optional(Schema.String), section: Schema.optional(Schema.String) })) }), message.params, 'workspace/configuration');
        this.send({ jsonrpc: '2.0', id: message.id, result: params.items.map(() => null) });
      } else this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Server request is not permitted' } });
      return;
    }
    const message = decode(response, value, 'server response');
    if (('result' in message) === (message.error !== undefined)) throw new ConcordError('LanguageServerFailed', 'Response must contain exactly one of result or error');
    if (typeof message.id !== 'number') return;
    const entry = this.pending.get(message.id);
    if (entry === undefined) return; // Includes cancelled requests and late responses.
    this.pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error !== undefined) entry.reject(new ConcordError('LanguageServerFailed', `Language server request failed (${message.error.code})`));
    else entry.resolve(message.result);
  }
  remainingRequests(): number { return this.budgets.requests - this.nextId; }
  assertHealthy(): void {
    if (this.failed !== undefined) throw this.failed;
    if (this.buffer.length > 0 || this.length !== undefined) throw new ConcordError('LanguageServerFailed', 'Incomplete JSON-RPC frame at shutdown');
  }
}
