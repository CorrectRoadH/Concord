import { Schema } from 'effect';

export const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u));
export const RunId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u));
const Strings = Schema.Array(Schema.String);
export const ItemSchema = Schema.Struct({
  id: Id, goal: Schema.String, write: Strings, read: Schema.optional(Strings),
  blockedBy: Schema.optional(Strings), checks: Schema.optional(Strings),
});
export const PlanSchema = Schema.Struct({ format: Schema.Literal('concord.docs-work-plan/v1'), items: Schema.Array(ItemSchema).check(Schema.isMinLength(1)) });
export type Plan = typeof PlanSchema.Type;
export interface Item {
  readonly id: string; readonly goal: string; readonly write: readonly string[];
  readonly read: readonly string[]; readonly blockedBy: readonly string[]; readonly checks: readonly string[];
}
const Hash = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/u));
const PathDigest = Schema.Struct({ path: Schema.String, digest: Schema.NullOr(Hash) });
export const RunSchema = Schema.Struct({
  format: Schema.Literal('concord.docs-work-run/v1'), runId: RunId,
  baseCommit: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/u)), createdAt: Schema.String,
  configDigest: Hash, sharedPaths: Strings,
  items: Schema.Array(Schema.Struct({ id: Id, goal: Schema.String, write: Strings, read: Strings, blockedBy: Strings, checks: Strings, readDigest: Hash, readSnapshot: Schema.Array(PathDigest) })),
  sharedDigest: Hash, sharedSnapshot: Schema.Array(PathDigest),
});
export type Run = typeof RunSchema.Type;
export const CheckSchema = Schema.Struct({
  id: Schema.String, status: Schema.Literals(['passed', 'failed']), exitCode: Schema.NullOr(Schema.Number), outputDigest: Hash, summary: Schema.String,
});
export type Check = typeof CheckSchema.Type;
export const ReceiptSchema = Schema.Struct({
  format: Schema.Literal('concord.docs-work-receipt/v1'), runId: RunId, itemId: Id,
  baseCommit: Schema.String, checkedAt: Schema.String, configDigest: Hash, readDigest: Hash, writeDigest: Hash,
  changedPaths: Strings, status: Schema.Literals(['reported', 'verified']), reportedReceipt: Schema.optional(Hash),
  dependencies: Schema.optional(Schema.Array(Schema.Struct({ itemId: Id, verifiedReceipt: Hash }))), checks: Schema.Array(CheckSchema),
});
export type Receipt = typeof ReceiptSchema.Type;
export const FinalizeSchema = Schema.Struct({
  operation: Schema.Literal('docs-work-finalize'), status: Schema.Literals(['finalized', 'failed', 'blocked']),
  blocked: Schema.optional(Schema.Array(Schema.Struct({ itemId: Schema.String, reason: Schema.String }))),
  finalizer: Schema.optional(Schema.Struct({ exitCode: Schema.NullOr(Schema.Number), outputDigest: Hash, summary: Schema.String })),
});
export type Finalize = typeof FinalizeSchema.Type;
export interface Problem { readonly code: string; readonly item?: string; readonly path?: string; readonly message: string }
export class DocsWorkError extends Schema.TaggedError<DocsWorkError>()('DocsWorkError', {
  code: Schema.String, message: Schema.String, details: Schema.optional(Schema.Unknown),
}) {}
export const problem = (message: string, problems: readonly Problem[]) => new DocsWorkError({ code: 'DocsWorkPlanInvalid', message, details: { problems } });
export const fail = (code: string, message: string, details?: unknown) => new DocsWorkError({ code, message, ...(details === undefined ? code === 'DocsWorkPlanInvalid' ? { details: { problems: [{ code: 'UnsafePath', message }] } } : {} : { details }) });
