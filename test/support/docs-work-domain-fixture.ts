import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Result, Schema } from 'effect';
import { prepareDocsWork, showDocsWork, checkDocsWork, finalizeDocsWork } from '../../src/app/index.ts';
import { model_DocsWorkError as DocsWorkError, renderWritingPolicy } from '../../src/model/index.ts';
import { LocalRepository, runApplication } from './repository.ts';
import { fixture, git } from './docs-work-fixture.ts';
import { initialize } from './operations.ts';

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
export const prepare = async (root: string, input: Omit<Parameters<typeof prepareDocsWork>[0], 'root' | 'scopes'> & { scopes?: readonly string[] }, status = 0) => outcome(prepareDocsWork({ root, scopes: [], ...input }), status !== 0);
export const plan = async (root: string, items: unknown[], runId: string) => (await prepare(root, { plan: { format: 'concord.docs-work-plan/v1', items }, runId }));
export const check = async (root: string, runId: string, itemId: string, mode: Parameters<typeof checkDocsWork>[2], status = 0) => outcome(checkDocsWork(runId, itemId, mode, root), status !== 0);
export const report = async (root: string, runId: string, itemId: string) => (await check(root, runId, itemId, { report: true }));
export const verify = async (root: string, runId: string, itemId: string, digest: string) => (await check(root, runId, itemId, { report: false, verify: digest }));
export const finalize = async (root: string, runId: string, status = 0) => outcome(finalizeDocsWork(runId, root), status !== 0);
export const show = async (root: string, runId: string) => outcome(showDocsWork(runId, root));
export const item = (id: string, write: string[], rest: Record<string, unknown> = {}) => ({ id, goal: `Update ${id}`, write, ...rest });

export async function initializedFixture(): Promise<string> {
  const root = fixture(undefined, false);
  try {
    const repository = await LocalRepository.open(root, { initialize: true, persistentCache: 'off' });
    try { await initialize(repository, false, { testRoots: [] }); } finally { repository.close(); }
    writeFileSync(join(root, 'docs/writing.md'), renderWritingPolicy({ roots: ['docs/a', 'docs/b'], bannedTerms: [{ term: 'Forbidden', use: 'Allowed', why: 'Fixture rule' }] }));
    git(root, 'add', '.'); git(root, 'commit', '-qm', 'initialized');
    return root;
  } catch (cause) {
    rmSync(root, { recursive: true, force: true });
    throw cause;
  }
}
