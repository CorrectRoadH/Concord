import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { FinalizeSchema, PlanSchema, ReceiptSchema, RunSchema, fail, problem, type Check, type Item, type Plan, type Problem, type Receipt, type Run } from './model.js';
import { atomicJson, decode, digestPaths, expand, git, hash, matches, now, nul, objectHash, overlap, readJson, runProcess, safePath, statePath, snapshotPaths, tailSummary, withLock } from './runtime.js';
import type { ProjectConfig, Repository } from 'concord-sdlc/model';

interface MainOwners {
  storage: { discoverRoot: (input?: string) => string; LocalRepository: new (root: string, options: { access: 'read' }) => Repository & { close: () => void } };
  config: { parseTypeScriptConfig: (source: string) => ProjectConfig };
  writing: { checkWriting: (repo: Repository) => { ok: boolean; findings: readonly { file: string }[] } };
  project: { checkProject: (repo: Repository) => { ok: boolean } };
}

// Source and repository builds have separate roots. These existing main-CLI
// owners are loaded from the installed package, never a consumer checkout.
const host = Effect.fn('DocsWork.host')(function*() {
  const source = new URL(import.meta.url).pathname.endsWith('.ts');
  const storageModule = source ? '../../../src/storage.ts' : '../../../storage.js';
  const configModule = source ? '../../../src/config.ts' : '../../../config.js';
  const writingModule = source ? '../../../src/writing.ts' : '../../../writing.js';
  const projectModule = source ? '../../../src/project-check.ts' : '../../../project-check.js';
  return yield* Effect.tryPromise({ try: async () => ({
    storage: await import(storageModule) as MainOwners['storage'],
    config: await import(configModule) as MainOwners['config'],
    writing: await import(writingModule) as MainOwners['writing'],
    project: await import(projectModule) as MainOwners['project'],
  }), catch: cause => fail('DocsWorkPlanInvalid', String(cause)) });
});
const context = Effect.fn('DocsWork.context')(function*(input?: string, existing = false) {
  const main = yield* host();
  const root = yield* Effect.try({ try: () => main.storage.discoverRoot(input), catch: cause => fail(existing ? 'DocsWorkConfigChanged' : 'DocsWorkPlanInvalid', String(cause)) });
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs.readFileString(join(root, 'concord.config.ts')).pipe(Effect.mapError(() => fail(existing ? 'DocsWorkConfigChanged' : 'DocsWorkPlanInvalid', 'Cannot read project configuration')));
  const config = yield* Effect.try({ try: () => main.config.parseTypeScriptConfig(source), catch: cause => fail(existing ? 'DocsWorkConfigChanged' : 'DocsWorkPlanInvalid', String(cause)) });
  return { root, config, configDigest: objectHash({ source, docsWork: config.docsWork ?? {} }), main };
});
type Context = Effect.Success<ReturnType<typeof context>>;
const universe = Effect.fn('DocsWork.universe')(function*(root: string, base: string) {
  return [...new Set([
    ...nul(yield* git(root, ['ls-tree', '-r', '--name-only', '-z', base])),
    ...nul(yield* git(root, ['ls-files', '-z'])),
    ...nul(yield* git(root, ['ls-files', '--others', '--exclude-standard', '-z'])),
  ])].sort();
});
const changed = Effect.fn('DocsWork.changed')(function*(root: string, base: string) {
  return [...new Set([
    ...nul(yield* git(root, ['diff', '--name-only', '--no-renames', '-z', base, '--'])),
    ...nul(yield* git(root, ['ls-files', '--others', '--exclude-standard', '-z'])),
  ])].sort();
});
function ancestors(item: Item, items: readonly Item[]): Set<string> {
  const seen = new Set<string>();
  const pending = [...item.blockedBy];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const dependency = items.find(candidate => candidate.id === id);
    if (dependency) pending.push(...dependency.blockedBy);
  }
  return seen;
}
const reads = Effect.fn('DocsWork.reads')(function*(root: string, item: Item, items: readonly Item[], files: readonly string[]) {
  const excluded = [item, ...items.filter(candidate => ancestors(item, items).has(candidate.id))].flatMap(candidate => candidate.write);
  return (yield* expand(root, item.read, files, true)).filter(path => !excluded.some(entry => matches(path, entry)));
});
function shown(run: Run, path: string, operation: string) {
  return { operation, runId: run.runId, baseCommit: run.baseCommit, configDigest: run.configDigest,
    items: run.items.map(({ readDigest: _, readSnapshot: __, ...item }) => item), statePath: path };
}
const normalizeDirectory = Effect.fn('DocsWork.normalizeDirectory')(function*(root: string, path: string) {
  yield* safePath(root, path);
  if (path.includes('*') || path.endsWith('/')) return path;
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(join(root, path)).pipe(Effect.catch(error => error.reason._tag === 'NotFound' ? Effect.succeed(undefined) : Effect.fail(error)));
  return info?.type === 'Directory' ? `${path}/` : path;
});
export const prepareDocsWork = Effect.fn('DocsWork.prepare')(function*(input: { root?: string | undefined; scopes: readonly string[]; plan?: unknown; base?: string | undefined; runId?: string | undefined }) {
  const ctx = yield* context(input.root);
  const problems: Problem[] = [];
  if ((input.plan !== undefined) === (input.scopes.length > 0)) return yield* problem('Specify scopes or plan', [{ code: 'EmptyWrite', message: 'Specify exactly one of --scope and --plan' }]);
  const plan: Plan = input.plan === undefined ? { format: 'concord.docs-work-plan/v1', items: input.scopes.map(path => ({ id: basename(path.replace(/\/$/u, '')), goal: `Update ${path}`, write: [path] })) } : yield* decode(PlanSchema, input.plan, 'plan');
  const items: Item[] = [];
  for (const raw of plan.items) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(raw.id)) problems.push({ code: 'UnsafePath', item: raw.id, message: 'Invalid item ID' });
    const write: string[] = [];
    for (const path of raw.write) {
      const result = yield* normalizeDirectory(ctx.root, path).pipe(Effect.result);
      if (result._tag === 'Success') write.push(result.success);
      else problems.push({ code: 'UnsafePath', item: raw.id, path, message: 'Unsafe write path' });
    }
    const read: string[] = [];
    for (const path of raw.read ?? []) {
      const result = yield* normalizeDirectory(ctx.root, path).pipe(Effect.result);
      if (result._tag === 'Failure') problems.push({ code: 'UnsafePath', item: raw.id, path, message: 'Unsafe read path' });
      else read.push(result.success);
    }
    items.push({ id: raw.id, goal: raw.goal, write, read, blockedBy: raw.blockedBy ?? [], checks: raw.checks ?? ['writing'] });
  }
  let base = '';
  const resolved = yield* git(ctx.root, ['rev-parse', '--verify', `${input.base ?? 'HEAD'}^{commit}`]).pipe(Effect.result);
  if (resolved._tag === 'Failure') problems.push({ code: 'BaseNotAncestor', message: 'Base must be an ancestor commit of HEAD' });
  else {
    base = resolved.success.trim();
    const ancestor = yield* git(ctx.root, ['merge-base', '--is-ancestor', base, 'HEAD']).pipe(Effect.result);
    if (ancestor._tag === 'Failure') problems.push({ code: 'BaseNotAncestor', message: 'Base must be an ancestor commit of HEAD' });
  }
  const fs = yield* FileSystem.FileSystem;
  const sharedPaths = [...new Set([...(ctx.config.docsWork?.sharedPaths ?? ['docs/README.md', ...(yield* Effect.filter(['docs/concepts.json', 'docs/concord-writing.json'], path => fs.exists(join(ctx.root, path))))]), 'concord.config.ts'])];
  for (const path of sharedPaths) {
    const result = yield* safePath(ctx.root, path).pipe(Effect.result);
    if (result._tag === 'Failure') problems.push({ code: 'UnsafePath', path, message: 'Unsafe shared path' });
  }
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) problems.push({ code: 'DuplicateItemId', item: item.id, message: 'Item ID is duplicated' });
    ids.add(item.id);
    if (!item.write.length) problems.push({ code: 'EmptyWrite', item: item.id, message: 'Write set is empty' });
    for (const check of item.checks) if (check !== 'writing' && ctx.config.docsWork?.checks?.[check] === undefined) problems.push({ code: 'UnknownCheck', item: item.id, message: `Unknown check ${check}` });
    for (const dependency of item.blockedBy) if (!items.some(candidate => candidate.id === dependency)) problems.push({ code: 'UnknownDependency', item: item.id, message: `Unknown dependency ${dependency}` });
    if (ancestors(item, items).has(item.id)) problems.push({ code: 'DependencyCycle', item: item.id, message: 'Dependency cycle' });
    for (const entry of item.write) for (const path of sharedPaths) if (overlap(entry, path)) problems.push({ code: 'SharedPathWrite', item: item.id, path, message: 'Write owns a shared path' });
    for (const other of items) {
      if (other === item) continue;
      for (const a of item.write) for (const b of other.write) if (overlap(a, b)) problems.push({ code: 'WriteOverlap', item: item.id, path: a, message: `Write overlaps ${other.id}: ${b}` });
      if (item.write.some(a => other.read.some(b => overlap(a, b))) && !ancestors(other, items).has(item.id)) problems.push({ code: 'UndeclaredDependency', item: other.id, message: `Read depends on ${item.id}` });
    }
  }
  const files = base ? yield* universe(ctx.root, base) : [];
  const dirty = [...new Set([
    ...nul(yield* git(ctx.root, ['diff', '--name-only', '--no-renames', '-z', '--'])),
    ...nul(yield* git(ctx.root, ['diff', '--cached', '--name-only', '--no-renames', '-z', '--'])),
    ...nul(yield* git(ctx.root, ['ls-files', '--others', '--exclude-standard', '-z'])),
  ])];
  for (const item of items) {
    for (const [entries, read] of [[item.write, false], [item.read, true]] as const) {
      const result = yield* expand(ctx.root, entries, files, read).pipe(Effect.result);
      if (result._tag === 'Failure') {
        const error = result.failure;
        if (error._tag === 'DocsWorkError' && error.code === 'DocsWorkPlanInvalid') problems.push(...(error.details as { problems: Problem[] }).problems.map(p => ({ ...p, item: item.id })));
        else return yield* Effect.fail(error);
      }
    }
    for (const path of dirty) if ([...item.write, ...item.read].some(entry => matches(path, entry))) problems.push({ code: 'DirtyPath', item: item.id, path, message: 'Declared input has uncommitted changes' });
  }
  for (const path of dirty) if (sharedPaths.some(entry => matches(path, entry))) problems.push({ code: 'DirtyPath', path, message: 'Shared input has uncommitted changes' });
  const runId = input.runId ?? `docs-${yield* ClockId()}-${randomUUID().slice(0, 8)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(runId)) problems.push({ code: 'UnsafePath', message: 'Invalid run ID' });
  if (problems.length) return yield* problem('Invalid Docs Work plan', problems);
  const path = yield* statePath(ctx.root, runId);
  if (yield* fs.exists(path)) return yield* fail('DocsWorkRunExists', `Run ${runId} already exists`);
  const preparedItems = yield* Effect.forEach(items, item => Effect.gen(function*() {
    const readSnapshot = yield* snapshotPaths(ctx.root, yield* reads(ctx.root, item, items, files));
    return { ...item, readSnapshot, readDigest: objectHash(readSnapshot) };
  }));
  const sharedSnapshot = yield* snapshotPaths(ctx.root, yield* expand(ctx.root, sharedPaths, files));
  const run: Run = { format: 'concord.docs-work-run/v1', runId, baseCommit: base, createdAt: yield* now,
    configDigest: ctx.configDigest, sharedPaths, items: preparedItems,
    sharedSnapshot, sharedDigest: objectHash(sharedSnapshot),
  };
  yield* fs.makeDirectory(join(path, '..'), { recursive: true });
  yield* fs.makeDirectory(path).pipe(Effect.mapError(() => fail('DocsWorkRunExists', `Run ${runId} already exists`)));
  yield* withLock(path, atomicJson(join(path, 'run.json'), run));
  return shown(run, path, 'docs-work-prepare');
});
const ClockId = () => now.pipe(Effect.map(value => value.replace(/[^0-9]/gu, '')));
export const showDocsWork = Effect.fn('DocsWork.show')(function*(runId: string, input?: string) {
  const main = yield* host();
  const root = yield* Effect.try({ try: () => main.storage.discoverRoot(input), catch: cause => fail('DocsWorkPlanInvalid', String(cause)) });
  const path = yield* statePath(root, runId);
  const run = yield* readJson(join(path, 'run.json'), RunSchema);
  if (run.runId !== runId) return yield* fail('DocsWorkReceiptMismatch', 'Run identity does not match state directory');
  return shown(run, path, 'docs-work-show');
});
const load = Effect.fn('DocsWork.load')(function*(ctx: Context, path: string) {
  const run = yield* readJson(join(path, 'run.json'), RunSchema);
  if (run.runId !== basename(path)) return yield* fail('DocsWorkReceiptMismatch', 'Run identity does not match state directory');
  if (ctx.configDigest !== run.configDigest) return yield* fail('DocsWorkConfigChanged', 'Project configuration changed since prepare');
  return run;
});
function changedInputs(before: readonly { path: string; digest: string | null }[], after: readonly { path: string; digest: string | null }[]): string[] {
  const old = new Map(before.map(entry => [entry.path, entry.digest]));
  const current = new Map(after.map(entry => [entry.path, entry.digest]));
  return [...new Set([...old.keys(), ...current.keys()])].filter(path => old.get(path) !== current.get(path)).sort();
}
const current = Effect.fn('DocsWork.current')(function*(ctx: Context, run: Run, item: Run['items'][number]) {
  const files = [...new Set([...(yield* universe(ctx.root, run.baseCommit)), ...item.readSnapshot.map(entry => entry.path), ...run.sharedSnapshot.map(entry => entry.path)])].sort();
  const write = yield* expand(ctx.root, item.write, files);
  const read = yield* reads(ctx.root, item, run.items, files);
  const readSnapshot = yield* snapshotPaths(ctx.root, read);
  const sharedSnapshot = yield* snapshotPaths(ctx.root, yield* expand(ctx.root, run.sharedPaths, files));
  const readDigest = objectHash(readSnapshot);
  const sharedDigest = objectHash(sharedSnapshot);
  if (readDigest !== item.readDigest || sharedDigest !== run.sharedDigest) return yield* fail('DocsWorkReadChanged', 'Read or shared inputs changed', { paths: changedInputs([...item.readSnapshot, ...run.sharedSnapshot], [...readSnapshot, ...sharedSnapshot]) });
  return { write, readDigest, writeDigest: yield* digestPaths(ctx.root, write), changedPaths: (yield* changed(ctx.root, run.baseCommit)).filter(path => item.write.some(entry => matches(path, entry))) };
});
const runBuiltin = Effect.fn('DocsWork.runBuiltin')(function*(ctx: Context, kind: 'writing' | 'finalizer', paths: readonly string[] = []) {
  return yield* Effect.acquireUseRelease(
    Effect.try({ try: () => new ctx.main.storage.LocalRepository(ctx.root, { access: 'read' }), catch: cause => fail('DocsWorkPlanInvalid', String(cause)) }),
    repo => Effect.try({ try: () => {
      if (kind === 'finalizer') {
        const result = ctx.main.project.checkProject(repo);
        const output = JSON.stringify(result);
        return { exitCode: result.ok ? 0 : 1, outputDigest: hash(output), summary: tailSummary(output) };
      }
      // checkWriting's optional argument selects a policy, not a document.
      // Keep its default rule evaluation, then project findings onto this item.
      const selected = new Set(paths);
      const report = ctx.main.writing.checkWriting(repo);
      const findings = report.findings.filter(finding => selected.has(finding.file));
      const result = { ok: findings.length === 0, findings };
      const output = JSON.stringify(result);
      return { exitCode: result.ok ? 0 : 1, outputDigest: hash(output), summary: tailSummary(output) };
    }, catch: cause => fail('DocsWorkPlanInvalid', String(cause)) }).pipe(Effect.catch(error => Effect.succeed({ exitCode: 1, outputDigest: hash(error.message), summary: tailSummary(error.message) }))),
    repo => Effect.sync(() => repo.close()),
  );
});
const runCheck = Effect.fn('DocsWork.runCheck')(function*(ctx: Context, id: string, paths: readonly string[]) {
  const command = ctx.config.docsWork?.checks?.[id];
  const result = command ? yield* runProcess(ctx.root, command.argv.flatMap(arg => arg === '{paths}' ? paths : [arg]), command.timeoutMs ?? 600000) : yield* runBuiltin(ctx, 'writing', paths);
  return { id, status: result.exitCode === 0 ? 'passed' as const : 'failed' as const, ...result } satisfies Check;
});
const receiptPath = (path: string, id: string, status: 'reported' | 'verified') => join(path, 'receipts', `${id}.${status}.json`);
const optionalReceipt = Effect.fn('DocsWork.optionalReceipt')(function*(path: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(path)) ? yield* readJson(path, ReceiptSchema).pipe(Effect.mapError(() => fail('DocsWorkReceiptMismatch', 'Receipt is invalid'))) : undefined;
});
export const checkDocsWork = Effect.fn('DocsWork.check')(function*(runId: string, itemId: string, mode: { report: boolean; verify?: string | undefined }, root?: string) {
  if (mode.report === (mode.verify !== undefined)) return yield* fail('DocsWorkReceiptMismatch', 'Specify exactly one of --report and --verify');
  const ctx = yield* context(root, true);
  const path = yield* statePath(ctx.root, runId);
  return yield* withLock(path, Effect.gen(function*() {
    const run = yield* load(ctx, path);
    const item = run.items.find(item => item.id === itemId);
    if (!item) return yield* fail('DocsWorkReceiptMismatch', 'Unknown item');
    const state = yield* current(ctx, run, item);
    const dependencies: { itemId: string; verifiedReceipt: string }[] = [];
    if (mode.verify !== undefined) {
      const reported = yield* optionalReceipt(receiptPath(path, itemId, 'reported'));
      if (!reported || reported.status !== 'reported' || reported.runId !== runId || reported.itemId !== itemId || reported.baseCommit !== run.baseCommit || reported.configDigest !== run.configDigest || reported.readDigest !== state.readDigest || objectHash(reported) !== mode.verify || reported.writeDigest !== state.writeDigest || reported.checks.some(check => check.status !== 'passed')) return yield* fail('DocsWorkReceiptMismatch', 'Reported receipt or write digest does not match');
      for (const dependency of item.blockedBy) {
        const receipt = yield* optionalReceipt(receiptPath(path, dependency, 'verified')).pipe(Effect.catch(() => Effect.succeed(undefined)));
        if (!receipt || receipt.status !== 'verified' || receipt.runId !== runId || receipt.itemId !== dependency || receipt.baseCommit !== run.baseCommit || receipt.configDigest !== run.configDigest || receipt.checks.some(check => check.status !== 'passed')) return yield* fail('DocsWorkDependencyUnverified', `Dependency ${dependency} is not verified`);
        dependencies.push({ itemId: dependency, verifiedReceipt: objectHash(receipt) });
      }
    }
    const checks = yield* Effect.forEach(item.checks, id => runCheck(ctx, id, state.write), { concurrency: 1 });
    // A command which edits its input cannot certify the pre-check digest.
    const after = yield* current(ctx, run, item);
    if (after.writeDigest !== state.writeDigest) return yield* fail('DocsWorkReceiptMismatch', 'Check changed the write set');
    const passed = checks.every(check => check.status === 'passed');
    const status = mode.verify !== undefined && passed ? 'verified' : 'reported';
    const receipt: Receipt = { format: 'concord.docs-work-receipt/v1', runId, itemId, baseCommit: run.baseCommit,
      checkedAt: yield* now, configDigest: run.configDigest, readDigest: state.readDigest, writeDigest: state.writeDigest,
      changedPaths: state.changedPaths, status, checks,
      ...(status === 'verified' ? { reportedReceipt: mode.verify!, dependencies } : {}),
    };
    yield* atomicJson(receiptPath(path, itemId, status), receipt);
    return { operation: 'docs-work-check', receipt, receiptDigest: objectHash(receipt) };
  }));
});
export const finalizeDocsWork = Effect.fn('DocsWork.finalize')(function*(runId: string, root?: string) {
  const main = yield* host();
  const resolvedRoot = yield* Effect.try({ try: () => main.storage.discoverRoot(root), catch: cause => fail('DocsWorkPlanInvalid', String(cause)) });
  const path = yield* statePath(resolvedRoot, runId);
  return yield* withLock(path, Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    if (yield* fs.exists(join(path, 'finalize.json'))) {
      const prior = yield* readJson(join(path, 'finalize.json'), FinalizeSchema);
      if (prior.status === 'finalized') return yield* fail('DocsWorkFinalized', 'Run is already finalized');
    }
    const ctx = yield* context(resolvedRoot, true);
    const run = yield* load(ctx, path);
    const blocked: { itemId: string; reason: string }[] = [];
    for (const item of run.items) {
      const receipt = yield* optionalReceipt(receiptPath(path, item.id, 'verified')).pipe(Effect.catch(() => Effect.succeed(undefined)));
      if (!receipt || receipt.status !== 'verified' || receipt.runId !== runId || receipt.itemId !== item.id || receipt.baseCommit !== run.baseCommit || receipt.configDigest !== run.configDigest || receipt.checks.some(check => check.status !== 'passed')) { blocked.push({ itemId: item.id, reason: 'Verified receipt is missing or failed' }); continue; }
      const state = yield* current(ctx, run, item).pipe(Effect.result);
      if (state._tag === 'Failure') blocked.push({ itemId: item.id, reason: 'Read or shared inputs changed' });
      else if (state.success.writeDigest !== receipt.writeDigest || state.success.readDigest !== receipt.readDigest) blocked.push({ itemId: item.id, reason: 'Write or read digest changed' });
      for (const dependency of item.blockedBy) {
        const currentReceipt = yield* optionalReceipt(receiptPath(path, dependency, 'verified')).pipe(Effect.catch(() => Effect.succeed(undefined)));
        if (!currentReceipt || receipt.dependencies?.find(entry => entry.itemId === dependency)?.verifiedReceipt !== objectHash(currentReceipt)) blocked.push({ itemId: item.id, reason: `Dependency ${dependency} was re-verified` });
      }
    }
    if (blocked.length) return { operation: 'docs-work-finalize' as const, status: 'blocked' as const, blocked };
    const allWrites = [...new Set(yield* expand(ctx.root, run.items.flatMap(item => item.write), yield* universe(ctx.root, run.baseCommit)))];
    const command = ctx.config.docsWork?.finalizer;
    const finalizer = command ? yield* runProcess(ctx.root, command.argv.flatMap(arg => arg === '{paths}' ? allWrites : [arg]), command.timeoutMs ?? 600000) : yield* runBuiltin(ctx, 'finalizer');
    const result = { operation: 'docs-work-finalize' as const, status: finalizer.exitCode === 0 ? 'finalized' as const : 'failed' as const, finalizer };
    yield* atomicJson(join(path, 'finalize.json'), result);
    return result;
  }));
});
