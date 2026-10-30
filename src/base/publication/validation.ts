import { Context, Effect, Layer } from "effect";
import type { Change, Repository, StepRename } from "../../model/index.js";

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
}>()('concord/Publication') {
  static readonly layer = Layer.effect(Publication, Effect.gen(function*() {
    const validation = yield* PublicationValidation;
    return Publication.of({ validation });
  }));
}
