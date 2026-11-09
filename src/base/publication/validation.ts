import { RuntimeEnvironment, runtimePath } from '../environment/index.ts';
import { Context, Effect, Layer, type Scope } from "effect";
import type { Change, Repository, StepRename, DocumentMovePlan } from "../../model/index.ts";
import { failure, ConcordError } from "../../model/index.ts";
import { acquireTraceLease, releaseTraceLease, type TraceLease } from './coordination.ts';
import { makePublicationReceiptStore } from './issue-receipts.ts';
import { inspectExportAncestors, publishExport } from './preview-tree.ts';
import { scratchDirectory } from './scratch.ts';
import { OperationCache } from '../cache/index.ts';

export interface PublicationCatalog {
  readonly operation: string;
  readonly scope: { readonly kind: string };
  readonly changes: readonly Change[];
}
export interface StepRenamePlan extends StepRename {
  readonly changes: readonly Change[];
  readonly affectedCases: readonly { readonly before: string; readonly after: string; readonly file: string; readonly named: boolean }[];
  readonly inputsDigest: string;
}
export interface IssueClosePlan {
  readonly issue: string;
  readonly changes: readonly Change[];
  readonly testFiles: readonly string[];
  readonly inputsDigest: string;
}
export class PublicationValidation extends Context.Service<PublicationValidation, {
  readonly validateWriting: (source: string, path: string) => void;
  readonly validateCatalog: (repo: Repository, journal: PublicationCatalog, fail: (message: string) => never) => void;
  readonly planIssueClose: (repo: Repository, request: { readonly issue: string }) => Promise<IssueClosePlan>;
  readonly planStepRename: (repo: Repository, request: StepRename) => Promise<StepRenamePlan>;
  readonly planDocumentMove: (repo: Repository, request: { readonly from: string; readonly to: string }) => Promise<DocumentMovePlan>;
}>()('concord/PublicationValidation') {}

/** A writer can only be constructed from a Publication layer with validation. */
export class Publication extends Context.Service<Publication, {
  readonly scratchDirectory: (root: string, namespace: string, prefix: string, location?: 'temporary') => ReturnType<typeof scratchDirectory>;
  readonly validation: PublicationValidation['Service'];
  readonly receiptStore: typeof makePublicationReceiptStore;
  readonly inspectExportAncestors: typeof inspectExportAncestors;
  readonly publishExport: (out: string, data: string, chain: Parameters<typeof publishExport>[2]) => ReturnType<typeof publishExport>;
  readonly lease: (root: string, operation: string, create?: boolean, reclaimDead?: boolean) => Effect.Effect<TraceLease | undefined, ConcordError, Scope.Scope>;
  readonly publish: (repo: Repository, operation: string, changes: readonly Change[], dryRun?: boolean) => Effect.Effect<Awaited<ReturnType<Repository['publish']>>, ConcordError>;
}>()('concord/Publication') {
  static readonly layer = Layer.effect(Publication, Effect.gen(function*() {
    const validation = yield* PublicationValidation;
    const runtime = yield* RuntimeEnvironment;
    return Publication.of({
      scratchDirectory: (root, namespace, prefix, location) => scratchDirectory(runtimePath(runtime, root), namespace, prefix, location, runtime),
      validation,
      receiptStore: root => makePublicationReceiptStore(runtimePath(runtime, root)),
      inspectExportAncestors: (out, root, privatePaths) => inspectExportAncestors(runtimePath(runtime, out), runtimePath(runtime, root), privatePaths.map(path => runtimePath(runtime, path))),
      publishExport: (out, data, chain) => publishExport(runtimePath(runtime, out), data, chain, runtime),
      lease: Effect.fn('Publication.lease')(function*(root: string, operation: string, create = true, reclaimDead = true) {
        const cache = yield* Effect.serviceOption(OperationCache);
        if (cache._tag === 'Some') {
          yield* Effect.acquireRelease(
            Effect.try({ try: cache.value.enterPublication, catch: failure }),
            () => Effect.sync(cache.value.leavePublication),
          );
        }
        return yield* Effect.acquireRelease(
          acquireTraceLease(runtimePath(runtime, root), 'exclusive', operation, create, reclaimDead, runtime.env).pipe(Effect.mapError(cause => new ConcordError(cause.message.includes('busy') ? 'RepositoryBusy' : 'CoordinationFailed', cause.message, { operation: cause.operation, path: cause.path, phase: cause.phase }))),
          lease => lease === undefined ? Effect.void : releaseTraceLease(lease, operation).pipe(Effect.orDie),
        );
      }),
      publish: Effect.fn('Publication.publish')((repo: Repository, operation: string, changes: readonly Change[], dryRun = false) =>
        Effect.tryPromise({ try: () => repo.publish(operation, changes, dryRun), catch: failure }).pipe(Effect.uninterruptible)),
    });
  }));
}
