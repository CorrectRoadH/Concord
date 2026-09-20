import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Effect, Schema } from 'effect';
import { NodeFileSystem, NodeRuntime } from '@effect/platform-node';
import { canonicalPath, git } from '../src/storage.js';
import { checkDocuments, loadDocuments } from '../src/documents.js';
import { ConcordError, GitCommit, ProjectSchema, Sha256, Text, decode, digest, type Change, type Repository } from '../src/shared.js';
import { mutateTraceFiles, withTraceReadLease } from '../repository/docs/trace/relation-mutation.js';
import { prepareMemoryMigration } from './migrate-memory.js';
import { prepareResearchFeedbackMigration, type MigrationAudit } from './migrate-research-feedback.js';
import { prepareEntrypointMigration } from './migration-entrypoints.js';
import { parseTypeScriptConfig, renderTypeScriptConfig } from '../src/config.js';
import { withMigrationJournalGuard } from './migration-recovery.js';

const roots = ['memory', 'feedback', 'docs/research', 'docs/issues'] as const;
const receiptPath = 'docs/migrations/concord-documents-20260914.json';
const FileDigest = Schema.Struct({ path: Text, digest: Sha256 });
const PlannedChange = Schema.Struct({ path: Text, beforeDigest: Schema.NullOr(Sha256), after: Schema.NullOr(Schema.String) });
export const MigrationPlanSchema = Schema.Struct({
  format: Schema.Literal('concord.document-migration/v1'), root: Text, head: GitCommit, at: Text,
  inputs: Schema.Array(FileDigest), outputs: Schema.Array(FileDigest), changes: Schema.Array(PlannedChange),
  counts: Schema.Struct({ memory: Schema.Int, researchFiles: Schema.Int, issues: Schema.Int }),
});
export type MigrationPlan = typeof MigrationPlanSchema.Type;
const asError = (cause: unknown): Error => cause instanceof Error ? cause : new Error(String(cause));

function source(root: string, path: string): string | null {
  canonicalPath(path);
  const target = join(root, path);
  let cursor = root;
  for (const part of path.split('/')) {
    cursor = join(cursor, part);
    try { if (lstatSync(cursor).isSymbolicLink()) throw new ConcordError('MigrationUnsafePath', path); }
    catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null; throw cause; }
  }
  if (!lstatSync(target).isFile()) throw new ConcordError('MigrationUnsafePath', `${path}: not a regular file`);
  return readFileSync(target, 'utf8');
}

function files(root: string, prefix: string): string[] {
  const result: string[] = [];
  const visit = (path: string): void => {
    canonicalPath(path);
    let stat;
    try { stat = lstatSync(join(root, path)); }
    catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return; throw cause; }
    if (stat.isSymbolicLink()) throw new ConcordError('MigrationUnsafePath', path);
    if (stat.isFile()) { result.push(path); return; }
    if (!stat.isDirectory()) throw new ConcordError('MigrationUnsafePath', path);
    for (const name of readdirSync(join(root, path)).sort()) visit(`${path}/${name}`);
  };
  visit(prefix);
  return result;
}

function inventory(root: string): { path: string; digest: string }[] {
  return roots.flatMap(prefix => files(root, prefix)).sort().map(path => ({ path, digest: digest(source(root, path)!) }));
}

function assertInventory(root: string, expected: readonly { readonly path: string; readonly digest: string }[]): void {
  const actual = inventory(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new ConcordError('MigrationInputsChanged', 'The complete document file set or its bytes changed; generate a fresh plan.');
}

function validatePlan(plan: MigrationPlan): void {
  if (resolve(plan.root) !== plan.root) throw new ConcordError('MigrationUnsafePath', 'Plan root must be absolute and canonical');
  for (const entries of [plan.inputs, plan.outputs, plan.changes]) {
    if (new Set(entries.map(entry => entry.path)).size !== entries.length) throw new ConcordError('MigrationDuplicatePath', 'Migration paths must be unique');
    for (const entry of entries) canonicalPath(entry.path);
  }
  if (plan.changes.length === 0) throw new ConcordError('MigrationEmpty', 'No changes were planned');
}

function verifyPlannedDocuments(root: string, changes: readonly Change[]): void {
  const planned = new Map(changes.map(change => [change.path, change.after]));
  const typedSource = source(root, 'concord.config.ts');
  const jsonSource = source(root, 'concord.json');
  if (typedSource !== null && jsonSource !== null) throw new ConcordError('MigrationConfigConflict', root);
  if (typedSource === null && jsonSource === null) throw new ConcordError('MigrationProjectMissing', root);
  const config = typedSource === null ? decode(ProjectSchema, JSON.parse(jsonSource!) as unknown, 'concord.json') : parseTypeScriptConfig(typedSource);
  const configSource = typedSource ?? renderTypeScriptConfig(config);
  const repo: Repository = {
    root, privateDir: '', config,
    configSnapshot: { path: 'concord.config.ts', source: configSource, digest: digest(configSource), config },
    read: path => (planned.has(path) ? planned.get(path) : source(root, path)) ?? undefined,
    files: prefix => [...new Set([...files(root, prefix), ...planned.keys()].filter(path => path.startsWith(`${prefix}/`) && planned.get(path) !== null))].sort(),
    absolute: path => { canonicalPath(path); return join(root, path); },
    publish: () => { throw new ConcordError('MigrationPlanIsReadOnly', 'Validation cannot publish'); },
  };
  const findings = checkDocuments(repo, loadDocuments(repo));
  if (findings.length > 0) throw new ConcordError('MigrationDocumentFindings', JSON.stringify(findings, null, 2));
}

/** Build a reviewable plan. The only write is the caller-selected plan artifact. */
export const prepareDocumentMigration = Effect.fn('prepareDocumentMigration')(function*(options: {
  root: string; memoryManifest: string; researchManifest: string; feedbackManifest: string;
  at: string; extraChanges?: readonly Change[];
  memoryOnly?: boolean; receipt?: string;
}): Effect.fn.Return<MigrationPlan, Error> {
  return yield* withMigrationJournalGuard(options.root, withTraceReadLease(options.root, () => Effect.gen(function*() {
    const head = git(options.root, ['rev-parse', 'HEAD']);
    const inputs = inventory(options.root);
    const targetReceipt = options.receipt ?? receiptPath;
    if (options.memoryOnly && (!options.receipt || !/^docs\/migrations\/[a-z0-9-]+\.json$/.test(targetReceipt) || source(options.root, targetReceipt) !== null)) {
      throw new ConcordError('MigrationReceiptConflict', 'Incremental Memory migration requires a new docs/migrations/<name>.json receipt.');
    }
    const memory = yield* prepareMemoryMigration(options.root, options.memoryManifest, options.at, options.memoryOnly);
    const researchFeedback = options.memoryOnly ? { audit: [], changes: [] } : yield* prepareResearchFeedbackMigration(options.root, options.researchManifest, options.feedbackManifest, head, options.at);
    const audit: readonly MigrationAudit[] = [...memory.audit, ...researchFeedback.audit];
    const changes: Change[] = [...memory.changes, ...researchFeedback.changes, ...(options.memoryOnly ? [] : prepareEntrypointMigration(options.root)), ...(options.extraChanges ?? [])];
    if (new Set(changes.map(change => change.path)).size !== changes.length) throw new ConcordError('MigrationDuplicatePath', 'Overlapping transformations must be composed before publication');
    if (!options.memoryOnly && (memory.audit.length !== 551 || researchFeedback.audit.length !== 188)) throw new ConcordError('MigrationCoverageMismatch', 'Expected 551 Memory, 132 Research files and 56 Issues');
    const counts = { memory: memory.audit.length, researchFiles: options.memoryOnly ? 0 : 132, issues: options.memoryOnly ? 0 : 56 };
    for (const change of changes) {
      if (source(options.root, change.path) !== change.before) throw new ConcordError('MigrationSourceChanged', change.path);
    }
    verifyPlannedDocuments(options.root, changes);
    const receipt = {
      format: 'concord.document-migration-receipt/v1', recordedAt: options.at, sourceCommit: head,
      counts,
      entries: audit.map(entry => ({ ...entry, targetDigest: digest(changes.find(change => change.path === entry.targetPath)?.after ?? source(options.root, entry.targetPath)!) })),
      evidence: 'Historical resolution attestations preserve source declarations and do not verify command or repository execution.',
    };
    changes.push({ path: targetReceipt, before: source(options.root, targetReceipt), after: `${JSON.stringify(receipt, null, 2)}\n` });
    const outputMap = new Map(inputs.map(input => [input.path, input.digest]));
    for (const change of changes) {
      if (!roots.some(prefix => change.path.startsWith(`${prefix}/`))) continue;
      if (change.after === null) outputMap.delete(change.path);
      else outputMap.set(change.path, digest(change.after));
    }
    assertInventory(options.root, inputs);
    if (git(options.root, ['rev-parse', 'HEAD']) !== head) throw new ConcordError('MigrationHeadChanged', 'HEAD changed while preparing');
    const plan = decode(MigrationPlanSchema, {
      format: 'concord.document-migration/v1', root: options.root, head, at: options.at, inputs,
      outputs: [...outputMap].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, digest]) => ({ path, digest })),
      changes: changes.map(change => ({ path: change.path, beforeDigest: change.before === null ? null : digest(change.before), after: change.after })),
      counts,
    }, 'migration plan');
    validatePlan(plan);
    return plan;
  }))).pipe(Effect.mapError(asError));
});

function completed(plan: MigrationPlan): boolean {
  return plan.changes.every(change => {
    const current = source(plan.root, change.path);
    return current === change.after;
  });
}

export const applyDocumentMigration = Effect.fn('applyDocumentMigration')(function*(plan: MigrationPlan) {
  validatePlan(plan);
  const alreadyCompleted = yield* withMigrationJournalGuard(plan.root, withTraceReadLease(plan.root, () => Effect.try({
    try: () => {
      if (!completed(plan)) return false;
      assertInventory(plan.root, plan.outputs);
      return true;
    }, catch: asError,
  })));
  if (alreadyCompleted) return { status: 'already-applied', counts: plan.counts };
  yield* withMigrationJournalGuard(plan.root, mutateTraceFiles({
    root: plan.root, operation: 'migrate-documents',
    prepareUnderLease: Effect.try({
      try: () => {
        if (git(plan.root, ['rev-parse', 'HEAD']) !== plan.head) throw new ConcordError('MigrationHeadChanged', 'HEAD changed since the reviewed plan');
        assertInventory(plan.root, plan.inputs);
        const changes = plan.changes.map(change => {
          const before = source(plan.root, change.path);
          if ((before === null ? null : digest(before)) !== change.beforeDigest) throw new ConcordError('MigrationPreimageChanged', change.path);
          return { path: change.path, before, after: change.after };
        });
        verifyPlannedDocuments(plan.root, changes);
        return plan.changes.map(change => ({ path: change.path, bytes: change.after, expectedDigest: change.beforeDigest }));
      }, catch: asError,
    }),
  }));
  yield* withMigrationJournalGuard(plan.root, withTraceReadLease(plan.root, () => Effect.try({ try: () => {
    if (!completed(plan)) throw new ConcordError('MigrationOutputChanged', 'Published files differ from the plan');
    assertInventory(plan.root, plan.outputs);
  }, catch: asError })));
  return { status: 'applied', counts: plan.counts };
});

const main = Effect.gen(function*() {
  const { values } = parseArgs({ options: {
    root: { type: 'string' }, plan: { type: 'string' }, apply: { type: 'boolean' },
    'memory-manifest': { type: 'string' }, 'research-manifest': { type: 'string' }, 'feedback-manifest': { type: 'string' },
    'memory-only': { type: 'boolean' }, receipt: { type: 'string' },
  } });
  if (values.plan === undefined) throw new ConcordError('MigrationOptionMissing', '--plan is required');
  if (values.apply) {
    const plan = decode(MigrationPlanSchema, JSON.parse(readFileSync(values.plan, 'utf8')) as unknown, values.plan);
    const result = yield* applyDocumentMigration(plan);
    yield* Effect.log(JSON.stringify(result));
    return;
  }
  if (values.root === undefined || values['memory-manifest'] === undefined || !values['memory-only'] && (values['research-manifest'] === undefined || values['feedback-manifest'] === undefined)) throw new ConcordError('MigrationOptionMissing', 'Preparation requires --root and all three --*-manifest paths, or --memory-only with --memory-manifest and --receipt');
  const root = resolve(values.root);
  const planFile = resolve(values.plan);
  if (planFile.startsWith(`${root}/`) || dirname(planFile) === root) throw new ConcordError('MigrationUnsafePlanPath', 'Save the review plan outside the consumer repository');
  const plan = yield* prepareDocumentMigration({ root, memoryManifest: values['memory-manifest'], researchManifest: values['research-manifest'] ?? '', feedbackManifest: values['feedback-manifest'] ?? '', at: new Date().toISOString(), memoryOnly: values['memory-only'], receipt: values.receipt });
  yield* Effect.try({ try: () => writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 }), catch: asError });
  yield* Effect.log(JSON.stringify({ status: 'prepared', plan: planFile, counts: plan.counts, changes: plan.changes.length }));
});

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  NodeRuntime.runMain(main.pipe(Effect.provide(NodeFileSystem.layer)));
}
