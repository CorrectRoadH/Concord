import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Effect, Result, Schema } from 'effect';
import { prepareDocsWork, showDocsWork, checkDocsWork, finalizeDocsWork } from '../../src/app/index.js';
import { model_DocsWorkError as DocsWorkError } from '../../src/model/index.js';
import { runApplication } from './repository.js';

const OutputSchema = Schema.Struct({
  operation: Schema.optional(Schema.String), runId: Schema.optional(Schema.String), statePath: Schema.optional(Schema.String), error: Schema.optional(Schema.String),
  details: Schema.optional(Schema.Struct({ problems: Schema.optional(Schema.Array(Schema.Struct({ code: Schema.String, path: Schema.optional(Schema.String) }))) })),
  receiptDigest: Schema.optional(Schema.String),
  receipt: Schema.optional(Schema.Struct({ status: Schema.String, writeDigest: Schema.String, changedPaths: Schema.Array(Schema.String), checks: Schema.Array(Schema.Struct({ status: Schema.String, exitCode: Schema.NullOr(Schema.Number), summary: Schema.String })) })),
  status: Schema.optional(Schema.String), blocked: Schema.optional(Schema.Array(Schema.Struct({ itemId: Schema.String, reason: Schema.String }))),
});
export type Output = typeof OutputSchema.Type;

const outcome = async (operation: Parameters<typeof runApplication>[0], expectedFailure = false): Promise<Output> => {
  const result = await runApplication(operation.pipe(Effect.scoped, Effect.result));
  if (Result.isFailure(result)) {
    assert.equal(expectedFailure, true, String(result.failure));
    assert.ok(result.failure instanceof DocsWorkError);
    return Schema.decodeUnknownSync(OutputSchema)({ error: result.failure.code, details: result.failure.details });
  }
  const value = Schema.decodeUnknownSync(OutputSchema)(result.success);
  const failed = value.receipt?.checks.some(check => check.status !== 'passed') || value.status === 'failed' || value.status === 'blocked';
  assert.equal(Boolean(failed), expectedFailure, JSON.stringify(value));
  return value;
};
export const readPlan = (path: string): unknown => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(readFileSync(path, 'utf8'));
export const prepare = (root: string, input: Omit<Parameters<typeof prepareDocsWork>[0], 'root' | 'scopes'> & { scopes?: readonly string[] }, status = 0) => outcome(prepareDocsWork({ root, scopes: [], ...input }), status !== 0);
export const plan = (root: string, items: unknown[], runId: string) => prepare(root, { plan: { format: 'concord.docs-work-plan/v1', items }, runId });
export const check = (root: string, runId: string, itemId: string, mode: Parameters<typeof checkDocsWork>[2], status = 0) => outcome(checkDocsWork(runId, itemId, mode, root), status !== 0);
export const report = (root: string, runId: string, itemId: string) => check(root, runId, itemId, { report: true });
export const verify = (root: string, runId: string, itemId: string, digest: string) => check(root, runId, itemId, { report: false, verify: digest });
export const finalize = (root: string, runId: string, status = 0) => outcome(finalizeDocsWork(runId, root), status !== 0);
export const show = (root: string, runId: string) => outcome(showDocsWork(runId, root));
export const item = (id: string, write: string[], rest: Record<string, unknown> = {}) => ({ id, goal: `Update ${id}`, write, checks: ['ok'], ...rest });
