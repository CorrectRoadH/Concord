// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { Context, Effect, Exit, Schema } from 'effect';
import { makeOwnedProcessService } from 'concord-sdlc/owned-process';
import { repositoryAdapterSnapshot, repositoryEngineDescriptor } from './adapter-identity.js';
import { RepositoryProfileError } from './root.js';
import {
  REPOSITORY_ADAPTER_FORMAT, REPOSITORY_PROTOCOL_BYTES, RepositoryAdapterPayloadSchemas,
  RepositoryAdapterResultSchemas, RepositoryAdapterGuardSchema,
  freezeRepositoryAdapterJson, repositoryAdapterResponseSchema, repositoryProtocolDecode,
  repositoryProtocolJson, validateRepositoryAdapterSources,
  type RepositoryAdapterGuard, type RepositoryAdapterOp, type RepositoryAdapterResult,
} from './process-protocol.js';
import type { ManagedTakeoverEvidence } from './host-types/index.js';

const STDERR_BYTES = 1024 * 1024;
// This is only the existing process owner; evidence capture is never process-global.
const processes = makeOwnedProcessService();
let cleanupUnknown = false;
const GuardCapture = Context.Reference<{ readonly add: (guards: readonly RepositoryAdapterGuard[]) => void } | undefined>('concord/repository/AdapterGuardCapture', { defaultValue: () => undefined });

const failure = (code: string, message: string) => new RepositoryProfileError(code, message);
const adapterError = (cause: unknown): RepositoryProfileError => cause instanceof RepositoryProfileError ? cause : failure('RepositoryAdapterInvalid', cause instanceof Error ? cause.message : String(cause));

export function captureRepositoryAdapterGuards<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<{ value: A; guards: readonly RepositoryAdapterGuard[] }, E, R> {
  return Effect.suspend(() => {
    const guards: RepositoryAdapterGuard[] = [];
    return Effect.gen(function* () {
      const parent = yield* GuardCapture;
      const value = yield* effect.pipe(Effect.provideService(GuardCapture, { add: items => { guards.push(...items); parent?.add(items); } }));
      // Preserve conflicting observations: local revalidation must reject them.
      return { value, guards: freezeRepositoryAdapterJson(guards) };
    });
  });
}

function guardDigest(root: string, path: string): string {
  const canonicalRoot = realpathSync(root);
  let current = canonicalRoot;
  const parts = path.split('/');
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error(`Guard is not an ordinary repository file: ${path}`);
  }
  if (realpathSync(current) !== resolve(canonicalRoot, path)) throw new Error(`Guard path changed: ${path}`);
  const fd = openSync(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) throw new Error(`Guard is not a regular file: ${path}`);
    const digest = 'sha256:' + createHash('sha256').update(readFileSync(fd)).digest('hex');
    const after = fstatSync(fd);
    const named = lstatSync(current);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || named.isSymbolicLink() || named.dev !== after.dev || named.ino !== after.ino || realpathSync(current) !== current) throw new Error(`Guard changed during capture: ${path}`);
    return digest;
  } finally { closeSync(fd); }
}

/** Lock-local revalidation performs no adapter invocation. */
export function validateRepositoryAdapterGuards(root: string, guards: readonly RepositoryAdapterGuard[]): void {
  try {
    const decoded = repositoryProtocolDecode(Schema.Array(RepositoryAdapterGuardSchema), guards);
    const seen = new Map<string, string>();
    for (const guard of decoded) {
      const prior = seen.get(guard.path);
      if (prior !== undefined && prior !== guard.digest) throw new Error(`Conflicting guard digests: ${guard.path}`);
      seen.set(guard.path, guard.digest);
      if (guardDigest(root, guard.path) !== guard.digest) throw new Error(`Guard bytes changed: ${guard.path}`);
    }
  } catch (cause) { throw failure('PreimageChanged', cause instanceof Error ? cause.message : String(cause)); }
}

const cleanupConfirmed = (result: { readonly processGroupOwned: boolean; readonly groupCleanup: { readonly owned: boolean; readonly checked: boolean; readonly gone: boolean | null } }) => result.processGroupOwned && result.groupCleanup.owned && result.groupCleanup.checked && result.groupCleanup.gone === true;

export function invokeRepositoryAdapter<O extends RepositoryAdapterOp>(root: string, op: O, payload: typeof RepositoryAdapterPayloadSchemas[O]['Type']): Effect.Effect<RepositoryAdapterResult<O>, RepositoryProfileError> {
  return Effect.gen(function* () {
    const prepared = yield* Effect.try({ try: () => {
      if (cleanupUnknown) throw failure('RepositoryAdapterCleanupUnknown', 'A previous repository adapter process group could not be confirmed terminated; further adapter requests are disabled.');
      if (process.platform === 'win32') throw failure('RepositoryAdapterCleanupUnknown', 'Repository adapters require observable POSIX process groups.');
      const canonicalRoot = realpathSync(root);
      const snapshot = repositoryAdapterSnapshot(canonicalRoot);
      if (snapshot === undefined) throw failure('RepositoryAdapterInvalid', 'This repository has no process adapter configured.');
      const engine = repositoryEngineDescriptor();
      const request = {
        format: REPOSITORY_ADAPTER_FORMAT, requestId: randomUUID(), root: canonicalRoot, engine,
        processGroup: { leaderPid: Number.MAX_SAFE_INTEGER }, op,
        payload: repositoryProtocolDecode(RepositoryAdapterPayloadSchemas[op] as Schema.ConstraintDecoder<unknown, never>, payload),
      };
      // Validate bytes, finite JSON and structural budgets before starting a process.
      repositoryProtocolJson(JSON.stringify(request));
      return { snapshot, engine, request, root: canonicalRoot };
    }, catch: adapterError });
    const capture = yield* GuardCapture;
    let readyFailure: string | undefined;
    let stdoutBytes = 0;
    let invalidUtf8 = false;
    const utf8 = new TextDecoder('utf-8', { fatal: true });
    const completedBefore = (yield* processes.cleanupResults).length;
    const run = Effect.scoped(Effect.gen(function* () {
      // Runs after the run acquisition finalizer, including on interruption.
      yield* Effect.addFinalizer(() => processes.cleanupResults.pipe(Effect.flatMap(results => Effect.sync(() => {
        if (results.slice(completedBefore).some(item => !cleanupConfirmed(item))) cleanupUnknown = true;
      }))));
      return yield* processes.run(prepared.snapshot.argv, {
        cwd: prepared.root, env: { ...prepared.snapshot.env }, timeoutMs: prepared.snapshot.timeoutMs,
        outputLimitBytes: prepared.snapshot.responseBytes + STDERR_BYTES,
        stdoutLimitBytes: prepared.snapshot.responseBytes, stderrLimitBytes: STDERR_BYTES,
        stream: {
          ready: (write, end, identity) => {
            if (identity.pid === undefined || identity.pid !== identity.groupId || !Number.isSafeInteger(identity.pid) || identity.pid <= 0) {
              readyFailure = 'The repository adapter has no verified process group leader.';
              end();
              return;
            }
            write(JSON.stringify({ ...prepared.request, processGroup: { leaderPid: identity.pid } }));
            end();
          },
          stdout: chunk => {
            stdoutBytes += chunk.byteLength;
            try { utf8.decode(chunk, { stream: true }); } catch { invalidUtf8 = true; }
          },
        },
      });
    })).pipe(Effect.mapError(() => failure('RepositoryAdapterFailed', 'The repository adapter could not be started or observed.')));
    const result = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const exit = yield* Effect.exit(restore(run));
      if (cleanupUnknown) return yield* Effect.fail(failure('RepositoryAdapterCleanupUnknown', 'The repository adapter process group could not be confirmed terminated; further adapter requests are disabled.'));
      return Exit.isSuccess(exit) ? exit.value : yield* Effect.failCause(exit.cause);
    }));
    return yield* Effect.try({ try: () => {
      if (!cleanupConfirmed(result)) {
        cleanupUnknown = true;
        throw failure('RepositoryAdapterCleanupUnknown', 'The repository adapter process group could not be confirmed terminated; further adapter requests are disabled.');
      }
      if (result.groupCleanup.aliveAfterLeaderClose !== false || readyFailure !== undefined || result.exitCode !== 0 || result.signal !== null || result.timedOut || result.cancelled || result.outputLimitExceeded || result.error !== undefined) {
        throw failure('RepositoryAdapterFailed', readyFailure ?? (result.timedOut ? 'Repository adapter timed out.' : result.outputLimitExceeded ? 'Repository adapter output exceeded its byte budget.' : result.groupCleanup.aliveAfterLeaderClose !== false ? 'Repository adapter left running process group members.' : 'Repository adapter did not exit successfully.'));
      }
      if (stdoutBytes > prepared.snapshot.responseBytes || stdoutBytes > REPOSITORY_PROTOCOL_BYTES || Buffer.byteLength(result.stderr) > STDERR_BYTES) throw failure('RepositoryAdapterFailed', 'Repository adapter stdout or stderr exceeded its byte budget.');
      try { utf8.decode(); } catch { invalidUtf8 = true; }
      if (invalidUtf8) throw failure('RepositoryAdapterInvalid', 'Repository adapter stdout is not valid UTF-8.');
      let after: ReturnType<typeof repositoryAdapterSnapshot>;
      let engineAfter: ReturnType<typeof repositoryEngineDescriptor>;
      try { after = repositoryAdapterSnapshot(prepared.root); engineAfter = repositoryEngineDescriptor(); }
      catch { throw failure('RepositoryAdapterChanged', 'Repository adapter or engine changed during the request.'); }
      if (after?.digest !== prepared.snapshot.digest || after.sourceDigest !== prepared.snapshot.sourceDigest || engineAfter.implementationDigest !== prepared.engine.implementationDigest || JSON.stringify(engineAfter.argv) !== JSON.stringify(prepared.engine.argv)) throw failure('RepositoryAdapterChanged', 'Repository adapter or engine changed during the request.');
      const response = repositoryProtocolDecode(repositoryAdapterResponseSchema(op), repositoryProtocolJson(result.stdout));
      const decoded = repositoryProtocolDecode(RepositoryAdapterResultSchemas[op] as Schema.ConstraintDecoder<RepositoryAdapterResult<O>, never>, response.result);
      if (response.requestId !== prepared.request.requestId || response.root !== prepared.root || response.engineDigest !== prepared.engine.implementationDigest) throw failure('RepositoryAdapterInvalid', 'Repository adapter response does not bind this request, root and engine.');
      if (op.startsWith('read-') && response.guards.length === 0) throw failure('RepositoryAdapterInvalid', 'Repository adapter read responses require nonempty guards.');
      try { validateRepositoryAdapterGuards(prepared.root, response.guards); }
      catch (cause) { throw failure('RepositoryAdapterInvalid', cause instanceof Error ? cause.message : 'Invalid repository adapter guards.'); }
      validateRepositoryAdapterSources(op, response.result);
      if (op === 'read-red') {
        const evidence = repositoryProtocolDecode(RepositoryAdapterResultSchemas['read-red'], response.result);
        if (evidence.id !== repositoryProtocolDecode(RepositoryAdapterPayloadSchemas['read-red'], payload).id || !response.guards.some(guard => guard.path === evidence.candidatePath && guard.digest === `sha256:${evidence.receipt.candidate.sha256}`)) throw failure('RepositoryAdapterInvalid', 'Red evidence does not bind the requested ID and guarded candidate bytes.');
      } else if (op === 'read-takeover') {
        const evidence = repositoryProtocolDecode(RepositoryAdapterResultSchemas['read-takeover'], response.result);
        if (evidence.id !== repositoryProtocolDecode(RepositoryAdapterPayloadSchemas['read-takeover'], payload).id || evidence.receipts.length === 0 || evidence.receipts.some(item => item.receipt.candidate.sha256 !== evidence.certificate.candidateSha256) || !response.guards.some(guard => guard.path === evidence.candidatePath && guard.digest === `sha256:${evidence.certificate.candidateSha256}`)) throw failure('RepositoryAdapterInvalid', 'Takeover evidence does not bind the requested ID and guarded candidate bytes.');
      }
      capture?.add(freezeRepositoryAdapterJson(response.guards));
      return freezeRepositoryAdapterJson(decoded);
    }, catch: adapterError });
  });
}

/** Construct a read-only Map only after strict wire decoding and unique-key checks. */
export function repositoryAdapterTakeover(value: RepositoryAdapterResult<'read-takeover'>): ManagedTakeoverEvidence {
  const receipts = new Map(value.receipts.map(item => [item.key, item.receipt] as const));
  const immutable = () => { throw new TypeError('Captured repository adapter receipts are immutable'); };
  Object.defineProperties(receipts, { set: { value: immutable }, delete: { value: immutable }, clear: { value: immutable } });
  Object.freeze(receipts);
  return Object.freeze({ ...value, receipts });
}
