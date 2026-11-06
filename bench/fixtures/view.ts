import { spawn } from 'node:child_process';
import { Effect, Schema } from 'effect';
import { io, PerfError } from '../../scripts/perf/process.ts';
import type { BenchContext } from '../../scripts/perf/scenario.ts';
const Ready = Schema.Struct({ operation: Schema.Literal('view'), root: Schema.String, host: Schema.String, port: Schema.Int, address: Schema.String, local: Schema.Array(Schema.String), network: Schema.Array(Schema.String) });
const Text = Schema.String;
const ProjectionError = Schema.Struct({ failedAt: Text, code: Text, message: Text });
export const WorkspaceResponse = Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({
  snapshot: Schema.Record(Schema.String, Schema.Json),
  projection: Schema.Struct({
    status: Schema.Literals(['ready', 'refresh-failed', 'blocked']), current: Schema.Literal(false),
    sourceDigest: Text, refreshOwner: Schema.Literals(['active', 'none']), builtAt: Text, builtFrom: Text, builtUntil: Text,
    complete: Schema.Boolean, changedPaths: Schema.Array(Text), unknownRelations: Schema.Boolean,
    lastError: Schema.optionalKey(ProjectionError),
    lastAttempt: Schema.optionalKey(Schema.Struct({ at: Text, complete: Schema.Boolean, changedPaths: Schema.Array(Text) })),
  }),
}) });
export const prepareView = Effect.fn('bench.prepareView')(function*(context: BenchContext) {
  const started = performance.now();
  if (!context.services.has('view')) {
  const handle = yield* Effect.acquireRelease(io('Start view', () => {
    const server = spawn(process.execPath, [context.artifact.entry, '--root', context.consumer.root, '--json', 'view', '--host', '127.0.0.1', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...context.env } });
    let stdout = '', stderr = '', closed = false; let failure: Error | undefined;
    const exited = new Promise<void>(resolve => server.once('close', () => { closed = true; resolve(); }));
    server.once('error', error => { failure = error; });
    server.stdout.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-131072); });
    server.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-131072); });
    return { server, exited, closed: () => closed, failure: () => failure, stdout: () => stdout, stderr: () => stderr };
  }), handle => Effect.promise(async () => {
    try {
      if (!handle.closed()) { handle.server.kill('SIGTERM'); const timer = setTimeout(() => handle.server.kill('SIGKILL'), 10000); try { await handle.exited; } finally { clearTimeout(timer); } }
    } finally { context.services.delete('view'); }
  }));
  while (!handle.stdout().includes('\n')) {
    if (handle.closed() || handle.failure() || performance.now() - started > 30000) return yield* new PerfError({ message: `View failed before ready (exit ${handle.server.exitCode}, signal ${handle.server.signalCode}): ${handle.failure() ?? ''} ${handle.stderr()} ${handle.stdout()}` });
    yield* Effect.sleep('10 millis');
  }
  const ready = yield* io('Decode view address', () => Schema.decodeUnknownSync(Schema.fromJsonString(Ready), { onExcessProperty: 'error' })(handle.stdout().split('\n')[0]!));
  context.services.set('view', ready.address);
  }
  const address = context.services.get('view')!;
  let last = '';
  while (performance.now() - started < context.refreshLimitMs + 30000) {
    const response = yield* Effect.tryPromise({ try: async signal => {
      const response = await fetch(new URL('api/workspace', address), { signal: AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.ceil(context.refreshLimitMs + 30000 - (performance.now() - started))))]) });
      return { status: response.status, text: await response.text() };
    }, catch: cause => new PerfError({ message: `Wait for view projection: ${String(cause)}` }) });
    last = response.text;
    if (response.status === 200) {
      yield* io('Decode workspace projection', () => Schema.decodeUnknownSync(Schema.fromJsonString(WorkspaceResponse), { onExcessProperty: 'error' })(response.text));
      return;
    }
    if (!/WorkspaceProjectionPending|HawdbBusy/u.test(last)) return yield* new PerfError({ message: `Workspace failed: ${last}` });
    yield* Effect.sleep('100 millis');
  }
  return yield* new PerfError({ message: `Workspace timed out: ${last}` });
});
