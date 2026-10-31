// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { pathToFileURL } from 'node:url';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, Layer, Schema } from 'effect';
import { Installation } from '../../../base/installation/index.js';
import { Workspace } from '../../../base/workspace/index.js';
import { Sources } from '../../../base/sources/index.js';
import { Git } from '../../../base/git/index.js';
import { Cache, CacheSnapshot, CacheDerivations, FeedbackCacheWriter } from '../../../base/cache/index.js';
import { Publication } from '../../../base/publication/index.js';
import { OwnedProcessLive } from '../../../base/process/index.js';
import { ServerRuntime } from '../../../base/server-lock/index.js';
import { executeViewAction, runWorkspaceTest, PublicationValidationLive } from '../../../app/index.js';
import { ConcordError, failure } from '../../../model/index.js';
import { OperationRequest, FRAME_LIMIT, connectWorkspaceSocket, submitFeedback } from '../index.js';

export const operationLayer = (snapshot: Parameters<typeof CacheSnapshot.layer>[0] = {}) => Layer.mergeAll(Installation.layer, ServerRuntime.layer, Workspace.layer, Sources.layer, Git.layer, Cache.layer, CacheSnapshot.layer(snapshot), Publication.layer.pipe(Layer.provide(PublicationValidationLive))).pipe(Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer));
const feedbackWriter = Layer.effect(FeedbackCacheWriter, Effect.gen(function*() {
  const workspace = yield* Workspace, runtime = yield* ServerRuntime;
  return FeedbackCacheWriter.of({ merge: (root, connectionId, items) => Effect.scoped(Effect.gen(function*() {
    const { privateDir } = yield* workspace.locate(root, true);
    const record = yield* Effect.try({ try: () => runtime.read(privateDir), catch: failure });
    if (!record) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'The operation has no running feedback owner'));
    const connection = yield* connectWorkspaceSocket(record.socket.path, runtime.installation(), record.token);
    return yield* submitFeedback(connection, connectionId, items);
  })) });
}));

export const runOperationMain = (): void => {
  const program = Effect.scoped(Effect.gen(function*() {
  const context = yield* Layer.build(feedbackWriter.pipe(Layer.provideMerge(operationLayer())));
  yield* Effect.sync(() => { process.stdout.write('{"ready":true}\n'); });
  const request = yield* Effect.tryPromise({ try: async () => {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk); size += bytes.byteLength;
      if (size > 32 * FRAME_LIMIT) throw new ConcordError('WorkspaceServerInputLimit', 'Operation input exceeds 32 MiB');
      chunks.push(bytes);
    }
    return Schema.decodeUnknownSync(Schema.fromJsonString(OperationRequest), { onExcessProperty: 'error' })(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)));
  }, catch: failure });
  const derived = CacheDerivations.make();
  const operation = request.kind === 'action' ? executeViewAction(request.root, request.input) : runWorkspaceTest(request.root, request.caseId);
  const value = yield* operation.pipe(Effect.provide(CacheSnapshot.layer(request.snapshot)), Effect.provideService(CacheDerivations, derived), Effect.provideContext(context));
  return { ok: true as const, value, derived: derived.batches() };
  })).pipe(Effect.catch(cause => { const error = failure(cause); return Effect.succeed({ ok: false as const, code: error.code, message: error.message, details: error.details }); }), Effect.flatMap(reply => Effect.sync(() => { process.stdout.write(JSON.stringify(reply)); })));
  NodeRuntime.runMain(program);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runOperationMain();
