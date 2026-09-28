// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { NodeRuntime } from '@effect/platform-node';
import { Effect, Queue, Schema } from 'effect';
import { getWorkspaceSnapshot } from './application.js';
import { ConcordError, failure } from './shared.js';
import { RequestTiming } from './view-request-log.js';
import { MAX_SCAN_REPLY_BYTES, ScanRequest, ScanMessage } from './view-scan-protocol.js';
import { setPublicationToken } from './file-lease.js';

const scan = (root: string, id: number) => Effect.gen(function*() {
  const timing = new RequestTiming(performance.now());
  const value = yield* getWorkspaceSnapshot(root, 'use', timing);
  timing.workspace(value);
  const body = JSON.stringify({ ok: true, value });
  if (Buffer.byteLength(body, 'utf8') > MAX_SCAN_REPLY_BYTES) return yield* Effect.fail(new ConcordError('WorkspaceScanOutputLimit', 'Workspace reply exceeds 128 MiB'));
  return { kind: 'success' as const, body, phases: timing.result(), observations: [...timing.observations], caches: timing.caches };
}).pipe(
  Effect.catch(cause => { const error = failure(cause); return Effect.succeed({ kind: 'failure' as const, code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) }); }),
  Effect.flatMap(reply => Schema.encodeEffect(ScanMessage)({ id, reply })),
  Effect.flatMap(output => Effect.tryPromise(() => new Promise<void>((resolve, reject) => process.send!(output, error => error ? reject(error) : resolve())))),
);

const main = Effect.gen(function*() {
  const root = yield* Schema.decodeUnknownEffect(Schema.String.check(Schema.isMinLength(1)))(process.argv[2]);
  yield* Effect.try(() => setPublicationToken(process.argv[3] ?? ''));
  const requests = yield* Queue.unbounded<unknown>();
  const message = (input: unknown) => { Queue.offerUnsafe(requests, input); };
  const disconnect = () => { Queue.offerUnsafe(requests, null); };
  yield* Effect.acquireRelease(Effect.sync(() => {
    process.on('message', message);
    process.once('disconnect', disconnect);
  }), () => Effect.sync(() => { process.off('message', message); process.off('disconnect', disconnect); }));
  while (true) {
    const input = yield* Queue.take(requests);
    if (input === null) return;
    const request = yield* Schema.decodeUnknownEffect(ScanRequest, { onExcessProperty: 'error' })(input);
    yield* scan(root, request.id);
  }
}).pipe(Effect.scoped);

NodeRuntime.runMain(main);
