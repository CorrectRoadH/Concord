import { Context, Effect, Layer, type Scope } from "effect";
import type { Change, Repository, StepRename } from "../../model/index.js";
import { failure, ConcordError } from "../../model/index.js";
import { acquireTraceLease, releaseTraceLease, type TraceLease } from './coordination.js';

export interface PublicationCatalog {
  readonly operation: string;
  readonly scope: { readonly kind: string };
  readonly changes: readonly Change[];
  readonly catalogDependencies?: readonly { readonly path: string; readonly digest: string }[];
}
export interface StepRenamePlan extends StepRename {
  readonly changes: readonly Change[];
  readonly affectedCases: readonly { readonly before: string; readonly after: string; readonly file: string; readonly named: boolean }[];
  readonly inputsDigest: string;
}
export class PublicationValidation extends Context.Service<PublicationValidation, {
  readonly validateWriting: (source: string, path: string) => void;
  readonly validateCatalog: (repo: Repository, journal: PublicationCatalog, fail: (message: string) => never) => void;
  readonly planStepRename: (repo: Repository, request: StepRename) => StepRenamePlan;
}>()('concord/PublicationValidation') {}

/** A writer can only be constructed from a Publication layer with validation. */
export class Publication extends Context.Service<Publication, {
  readonly validation: PublicationValidation['Service'];
  readonly lease: (root: string, operation: string, create?: boolean) => Effect.Effect<TraceLease | undefined, ConcordError, Scope.Scope>;
  readonly publish: (repo: Repository, operation: string, changes: readonly Change[], dryRun?: boolean) => Effect.Effect<ReturnType<Repository['publish']>, ConcordError>;
}>()('concord/Publication') {
  static readonly layer = Layer.effect(Publication, Effect.gen(function*() {
    const validation = yield* PublicationValidation;
    return Publication.of({
      validation,
      lease: Effect.fn('Publication.lease')(function*(root: string, operation: string, create = true) {
        return yield* Effect.acquireRelease(
          acquireTraceLease(root, 'exclusive', operation, create, true).pipe(Effect.mapError(cause => new ConcordError(cause.message.includes('busy') ? 'RepositoryBusy' : 'CoordinationFailed', cause.message, { operation: cause.operation, path: cause.path, phase: cause.phase }))),
          lease => lease === undefined ? Effect.void : releaseTraceLease(lease, operation).pipe(Effect.orDie),
        );
      }),
      publish: Effect.fn('Publication.publish')((repo: Repository, operation: string, changes: readonly Change[], dryRun = false) =>
        Effect.try({ try: () => repo.publish(operation, changes, dryRun), catch: failure })),
    });
  }));
}
