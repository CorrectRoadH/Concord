// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
import { Effect, Schema } from 'effect';
import { ConcordError, decode } from './shared.js';

export const RepositoryViewTestSchema = Schema.Struct({
  id: Schema.String, name: Schema.String, file: Schema.String, selector: Schema.String,
  contract: Schema.String, features: Schema.Array(Schema.String),
});
export type RepositoryViewTest = typeof RepositoryViewTestSchema.Type;
export interface RepositoryTestView {
  readonly status: 'not-configured' | 'ready' | 'failed';
  readonly tests: readonly RepositoryViewTest[];
  readonly error?: { readonly code: string; readonly message: string };
}

/** Load the installed profile projection without importing the consumer's host module. */
export const readRepositoryTestView = Effect.fn('view.readRepositoryTestView')(function*(root: string) {
  const modulePath = './repository/view-tests.js';
  const module: { readViewTests(root: string): Effect.Effect<unknown, unknown> } = yield* Effect.tryPromise({
    try: () => import(modulePath),
    catch: cause => new ConcordError('RepositoryProfileUnavailable', String(cause)),
  });
  const value = yield* module.readViewTests(root);
  return yield* Effect.try({
    try: () => decode(Schema.Array(RepositoryViewTestSchema), value, 'repository test projection'),
    catch: cause => new ConcordError('RepositoryProfileInvalid', String(cause)),
  });
});
