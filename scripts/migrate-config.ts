import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { NodeFileSystem, NodeRuntime } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { renderTypeScriptConfig } from '../src/config.js';
import { ConcordError, GitCommit, ProjectSchema, Text, decode, digest } from '../src/shared.js';
import { git } from '../src/storage.js';
import { mutateTraceFiles, withTraceReadLease } from '../repository/docs/trace/relation-mutation.js';
import { withMigrationJournalGuard } from './migration-recovery.js';

const oldPath = 'concord.json';
const newPath = 'concord.config.ts';
const asError = (cause: unknown): Error => cause instanceof Error ? cause : new Error(String(cause));
export const ConfigMigrationPlanSchema = Schema.Struct({
  format: Schema.Literal('concord.config-migration/v1'), root: Text, head: GitCommit,
  before: Schema.String, after: Schema.String,
});
export type ConfigMigrationPlan = typeof ConfigMigrationPlanSchema.Type;

function read(root: string, path: typeof oldPath | typeof newPath): string | null {
  const target = join(root, path);
  try {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new ConcordError('MigrationUnsafePath', target);
    return readFileSync(target, 'utf8');
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null;
    throw cause;
  }
}

function checkRoot(root: string): void {
  if (resolve(root) !== root || realpathSync(root) !== root || git(root, ['rev-parse', '--show-toplevel']) !== root) throw new ConcordError('MigrationUnsafePath', 'Migration root must be the canonical Git worktree root');
}

/** JSON decoding is confined to this offline conversion, never a runtime fallback. */
function convert(source: string): string {
  try { return renderTypeScriptConfig(decode(ProjectSchema, JSON.parse(source) as unknown, oldPath)); }
  catch (cause) { throw new ConcordError('MigrationInvalidConfig', asError(cause).message); }
}

export const prepareConfigMigration = Effect.fn('prepareConfigMigration')(function*(root: string) {
  return yield* withMigrationJournalGuard(root, withTraceReadLease(root, () => Effect.try({ try: () => {
    checkRoot(root);
    const before = read(root, oldPath);
    if (before === null) throw new ConcordError('MigrationSourceMissing', oldPath);
    if (read(root, newPath) !== null) throw new ConcordError('MigrationConfigConflict', 'Preserve both configuration files and resolve the conflict before migration');
    return decode(ConfigMigrationPlanSchema, {
      format: 'concord.config-migration/v1', root, head: git(root, ['rev-parse', 'HEAD']), before, after: convert(before),
    }, 'configuration migration plan');
  }, catch: asError })));
});

export const applyConfigMigration = Effect.fn('applyConfigMigration')(function*(plan: ConfigMigrationPlan) {
  yield* Effect.try({ try: () => {
    decode(ConfigMigrationPlanSchema, plan, 'configuration migration plan');
    checkRoot(plan.root);
    if (convert(plan.before) !== plan.after) throw new ConcordError('MigrationPlanInvalid', 'Planned configuration must preserve the exact decoded JSON values');
  }, catch: asError });
  const complete = (): boolean => read(plan.root, oldPath) === null && read(plan.root, newPath) === plan.after;
  if (yield* withMigrationJournalGuard(plan.root, withTraceReadLease(plan.root, () => Effect.try({ try: complete, catch: asError })))) return { status: 'already-applied' as const };
  yield* withMigrationJournalGuard(plan.root, mutateTraceFiles({ root: plan.root, operation: 'migrate-config', prepareUnderLease: Effect.try({ try: () => {
    if (git(plan.root, ['rev-parse', 'HEAD']) !== plan.head) throw new ConcordError('MigrationHeadChanged', 'HEAD changed since configuration planning');
    if (read(plan.root, oldPath) !== plan.before || read(plan.root, newPath) !== null) throw new ConcordError('MigrationPreimageChanged', 'Configuration changed since planning');
    return [
      { path: newPath, bytes: plan.after, expectedDigest: null },
      { path: oldPath, bytes: null, expectedDigest: digest(plan.before) },
    ];
  }, catch: asError }) }));
  yield* withMigrationJournalGuard(plan.root, withTraceReadLease(plan.root, () => Effect.try({ try: () => {
    if (!complete()) throw new ConcordError('MigrationOutputChanged', 'Configuration changed after publication');
  }, catch: asError })));
  return { status: 'applied' as const };
});

const main = Effect.gen(function*() {
  const { values } = parseArgs({ options: { root: { type: 'string' }, plan: { type: 'string' }, apply: { type: 'boolean' } } });
  if (values.plan === undefined) throw new ConcordError('MigrationOptionMissing', '--plan is required');
  if (values.apply) {
    const plan = yield* Effect.try({ try: () => decode(ConfigMigrationPlanSchema, JSON.parse(readFileSync(values.plan!, 'utf8')) as unknown, values.plan!), catch: asError });
    yield* Effect.log(JSON.stringify(yield* applyConfigMigration(plan)));
    return;
  }
  if (values.root === undefined) throw new ConcordError('MigrationOptionMissing', '--root is required');
  const root = resolve(values.root), planFile = resolve(values.plan);
  if (planFile.startsWith(`${root}/`) || dirname(planFile) === root) throw new ConcordError('MigrationUnsafePlanPath', 'Save the plan outside the consumer repository');
  const plan = yield* prepareConfigMigration(root);
  yield* Effect.try({ try: () => writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 }), catch: asError });
  yield* Effect.log(JSON.stringify({ status: 'prepared', plan: planFile }));
});

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) NodeRuntime.runMain(main.pipe(Effect.provide(NodeFileSystem.layer)));
