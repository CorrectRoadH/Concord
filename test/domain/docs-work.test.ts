// @use-case docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { tmpdir } from '../support/temporary.ts';
import { git, fixture, custom } from '../support/docs-work-fixture.ts';
import { plan, report, verify, prepare, check, finalize, show, item, readPlan, initializedFixture } from '../support/docs-work-domain-fixture.ts';

test('C5/C6 static checks dynamically own directory writes and bind verified dependency receipts', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = await initializedFixture();
  try {
    writeFileSync(join(root, 'outside.txt'), 'Unrelated change\n');
    const prepared = (await plan(root, [item('a', ['docs/a/']), item('b', ['docs/b/'], { read: ['docs/a/'], blockedBy: ['a'] })], 'dependencies'));
    assert.match(prepared.statePath!, /concord\/docs-work\/v1\/dependencies$/);
    const a = (await report(root, 'dependencies', 'a'));
    const b = (await report(root, 'dependencies', 'b'));
    const unverified = (await check(root, 'dependencies', 'b', { report: false, verify: b.receiptDigest! }, 1));
    assert.equal(unverified.error, 'DocsWorkDependencyUnverified');
    const blocked = (await finalize(root, 'dependencies', 1)); assert.equal(blocked.status, 'blocked');
    writeFileSync(join(root, 'docs/a/new.md'), '# New page\n');
    const dynamic = (await report(root, 'dependencies', 'a'));
    assert.notEqual(dynamic.receipt!.writeDigest, a.receipt!.writeDigest);
    assert.ok(dynamic.receipt!.changedPaths.includes('docs/a/new.md'));
    assert.deepEqual(JSON.parse(dynamic.receipt!.checks[0]!.summary), { ok: true, findings: [] });
    assert.equal((await check(root, 'dependencies', 'a', { report: false, verify: a.receiptDigest! }, 1)).error, 'DocsWorkReceiptMismatch');
    (await verify(root, 'dependencies', 'a', dynamic.receiptDigest!));
    (await verify(root, 'dependencies', 'b', b.receiptDigest!));
    (await verify(root, 'dependencies', 'a', dynamic.receiptDigest!));
    const stale = (await finalize(root, 'dependencies', 1)); assert.equal(stale.status, 'blocked'); assert.ok(stale.blocked!.some(entry => entry.itemId === 'b'));
    (await verify(root, 'dependencies', 'b', b.receiptDigest!));
    const originalB = readFileSync(join(root, 'docs/b/two.md'), 'utf8');
    writeFileSync(join(root, 'docs/b/two.md'), '# Changed write after verification\n');
    assert.equal((await finalize(root, 'dependencies', 1)).status, 'blocked');
    writeFileSync(join(root, 'docs/b/two.md'), originalB);
    assert.equal((await finalize(root, 'dependencies')).status, 'finalized');
    assert.equal((await finalize(root, 'dependencies', 1)).error, 'DocsWorkFinalized');
    assert.equal(existsSync(join(root, 'finalizer-count')), false);
    assert.equal((await show(root, 'dependencies')).runId, 'dependencies');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('C5 prepare aggregates dirty paths, overlaps, duplicate IDs, dependencies, cycles and unknown checks with zero state writes', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = fixture(custom);
  const path = join(tmpdir(), `docs-work-invalid-${process.pid}.json`);
  try {
    writeFileSync(join(root, 'docs/a/one.md'), '# Dirty\n'); git(root, 'add', 'docs/a/one.md');
    writeFileSync(join(root, 'docs/b/new.md'), '# Untracked\n');
    writeFileSync(path, JSON.stringify({ format: 'concord.docs-work-plan/v1', items: [
      item('duplicate', ['docs/a/'], { checks: ['missing'], blockedBy: ['cycle'] }),
      item('duplicate', ['docs/a/*.md']),
      item('reader', ['docs/b/'], { read: ['docs/a/'] }),
      item('cycle', ['docs/c/'], { blockedBy: ['duplicate', 'unknown'] }),
      item('shared', ['docs/README.md']), item('empty', [], { read: ['missing-read.md'] }),
    ] }));
    const result = (await prepare(root, { plan: readPlan(path), runId: 'invalid' }, 1));
    assert.equal(result.error, 'DocsWorkPlanInvalid');
    const codes = new Set(result.details!.problems!.map(problem => problem.code));
    for (const code of ['DirtyPath', 'WriteOverlap', 'DuplicateItemId', 'UndeclaredDependency', 'DependencyCycle', 'UnknownDependency', 'UnknownCheck', 'SharedPathWrite', 'EmptyWrite', 'EmptyRead']) assert.ok(codes.has(code), code);
    assert.equal(existsSync(join(root, '.git/concord/docs-work/v1/invalid')), false);
  } finally { rmSync(path, { force: true }); rmSync(root, { recursive: true, force: true }); }
})));

test('prepare rejects external checks, finalizers and timeout configuration before creating run state', () => Effect.runPromise(Effect.tryPromise(async () => {
  const command = { argv: [process.execPath, '-e', 'require("node:fs").writeFileSync("external-command", "ran")'], timeoutMs: 1000 };
  for (const docsWork of [{ checks: { writing: command } }, { finalizer: command }, { timeoutMs: 1000 }, { argv: command.argv }]) {
    const root = fixture();
    try {
      writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ docsWork })} as const;\n`);
      const rejected = await prepare(root, { scopes: ['docs/a/'], runId: 'external' }, 1);
      assert.equal(rejected.error, 'DocsWorkPlanInvalid');
      assert.equal(existsSync(join(root, '.git/concord/docs-work/v1/external')), false);
      assert.equal(existsSync(join(root, 'external-command')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
})));

test('writing is the only check ID, including when reading existing run state', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = fixture();
  try {
    const rejected = await prepare(root, { plan: { format: 'concord.docs-work-plan/v1', items: [item('custom', ['docs/a/'], { checks: ['custom'] })] }, runId: 'unknown' }, 1);
    assert.equal(rejected.error, 'DocsWorkPlanInvalid');
    assert.deepEqual(rejected.details?.problems?.map(problem => problem.code), ['UnknownCheck']);
    assert.equal(existsSync(join(root, '.git/concord/docs-work/v1/unknown')), false);
    const prepared = await prepare(root, { scopes: ['docs/a/'], runId: 'writing' });
    const path = join(prepared.statePath!, 'run.json');
    const run = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(run.items[0].checks, ['writing']);
    run.items[0].checks = ['custom'];
    writeFileSync(path, JSON.stringify(run));
    assert.equal((await check(root, 'writing', 'a', { report: true }, 1)).error, 'DocsWorkPlanInvalid');
    assert.equal(existsSync(join(prepared.statePath!, 'receipts/a.reported.json')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('default shared paths protect the global concepts.md catalog and writing policy', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = fixture(custom);
  try {
    writeFileSync(join(root, 'docs/concepts.md'), '# Project concepts\n');
    git(root, 'add', 'docs/concepts.md'); git(root, 'commit', '-qm', 'catalog');
    const path = join(tmpdir(), `docs-work-shared-${process.pid}.json`);
    writeFileSync(path, JSON.stringify({ format: 'concord.docs-work-plan/v1', items: [item('terms', ['docs/concepts.md']), item('policy', ['docs/writing.md'])] }));
    try {
      const result = (await prepare(root, { plan: readPlan(path), runId: 'shared' }, 1));
      const shared = result.details!.problems!.filter(problem => problem.code === 'SharedPathWrite').map(problem => problem.path).sort();
      assert.deepEqual(shared, ['docs/concepts.md', 'docs/writing.md']);
    } finally { rmSync(path, { force: true }); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('C5/C6 failed reports persist; read and configuration drift reject without running checks', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = await initializedFixture();
  try {
    const prepared = (await plan(root, [item('failed', ['docs/a/']), item('reader', ['docs/b/'], { read: ['docs/input.md'] })], 'drift'));
    writeFileSync(join(root, 'docs/a/one.md'), '# One\n\nForbidden text.\n');
    const failed = (await check(root, 'drift', 'failed', { report: true }, 1));
    assert.equal(failed.receipt!.checks[0]!.status, 'failed'); assert.equal(failed.receipt!.checks[0]!.exitCode, 1);
    assert.match(failed.receipt!.checks[0]!.summary, /Forbidden/);
    const receiptSource = readFileSync(join(prepared.statePath!, 'receipts/failed.reported.json'), 'utf8');
    assert.ok(existsSync(join(prepared.statePath!, 'receipts/failed.reported.json')));
    assert.equal((await check(root, 'drift', 'failed', { report: false, verify: failed.receiptDigest! }, 1)).error, 'DocsWorkReceiptMismatch');
    writeFileSync(join(root, 'docs/input.md'), '# Changed input\n');
    assert.equal((await check(root, 'drift', 'reader', { report: true }, 1)).error, 'DocsWorkReadChanged');
    assert.equal(existsSync(join(prepared.statePath!, 'receipts/reader.reported.json')), false);
    writeFileSync(join(root, 'docs/README.md'), '# Shared changed\n');
    assert.equal((await check(root, 'drift', 'failed', { report: true }, 1)).error, 'DocsWorkReadChanged');
    const configPath = join(root, 'concord.config.ts'); writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}\n`);
    assert.equal((await check(root, 'drift', 'failed', { report: true }, 1)).error, 'DocsWorkConfigChanged');
    assert.equal(readFileSync(join(prepared.statePath!, 'receipts/failed.reported.json'), 'utf8'), receiptSource);
    assert.equal((await finalize(root, 'drift', 1)).error, 'DocsWorkConfigChanged');
    writeFileSync(configPath, 'export default {broken:}');
    assert.equal((await check(root, 'drift', 'failed', { report: true }, 1)).error, 'DocsWorkConfigChanged');
    assert.equal(readFileSync(join(prepared.statePath!, 'receipts/failed.reported.json'), 'utf8'), receiptSource);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('scope prepare, exclusive locking, temporary cleanup, symlink rejection and strict config schema', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = fixture(custom);
  try {
    const run = (await prepare(root, { runId: 'scope', scopes: ['docs/a'] }));
    assert.equal((await prepare(root, { runId: 'scope', scopes: ['docs/a'] }, 1)).error, 'DocsWorkRunExists');
    writeFileSync(join(run.statePath!, 'lock'), '');
    assert.equal((await check(root, 'scope', 'a', { report: true }, 1)).error, 'DocsWorkBusy');
    rmSync(join(run.statePath!, 'lock'));
    writeFileSync(join(run.statePath!, '.tmp-abandoned'), 'partial');
    (await report(root, 'scope', 'a')); assert.equal(existsSync(join(run.statePath!, '.tmp-abandoned')), false);
    symlinkSync(join(root, 'docs/a'), join(root, 'linked'));
    assert.equal((await prepare(root, { runId: 'unsafe', scopes: ['linked/'] }, 1)).error, 'DocsWorkPlanInvalid');
    assert.ok(readdirSync(run.statePath!).includes('run.json'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('default writing uses docs check rules on item paths and finalizer calls checkProject', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = await initializedFixture();
  try {
    const run = (await prepare(root, { runId: 'builtin', scopes: ['docs/a/'] }));
    writeFileSync(join(root, 'docs/a/one.md'), '# One\n\nForbidden text.\n');
    const failed = (await check(root, 'builtin', 'a', { report: true }, 1)); assert.equal(failed.receipt!.checks[0]!.status, 'failed');
    writeFileSync(join(root, 'docs/a/one.md'), '# One\n\nAllowed text.\n');
    writeFileSync(join(root, 'docs/b/two.md'), '# Two\n\nForbidden text.\n');
    const passed = (await report(root, 'builtin', 'a')); (await verify(root, 'builtin', 'a', passed.receiptDigest!));
    const result = (await finalize(root, 'builtin', 1)); assert.equal(result.status, 'failed');
    assert.match(readFileSync(join(run.statePath!, 'finalize.json'), 'utf8'), /Forbidden/);
    writeFileSync(join(root, 'docs/b/two.md'), '# Two\n\nAllowed text.\n');
    assert.equal((await finalize(root, 'builtin')).status, 'finalized');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('static writing receipts retain failed findings with a bounded UTF-8 summary', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = await initializedFixture();
  try {
    await prepare(root, { runId: 'summary', scopes: ['docs/a/'] });
    writeFileSync(join(root, 'docs/a/one.md'), `# One\n\n${Array.from({ length: 30 }, () => `Forbidden ${'文'.repeat(150)}.`).join('\n\n')}\n`);
    const failed = await check(root, 'summary', 'a', { report: true }, 1);
    const result = failed.receipt!.checks[0]!;
    assert.equal(result.exitCode, 1);
    assert.equal(result.status, 'failed');
    assert.ok(Buffer.byteLength(result.summary) <= 4096);
    assert.match(result.summary, /文/);
    assert.equal(result.summary.includes('\uFFFD'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('glob ownership includes deletes, conservative prefixes overlap, paths and base commits are validated', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = fixture(custom);
  try {
    const prepared = (await plan(root, [item('glob', ['docs/a/**/*.md'])], 'glob'));
    const old = (await report(root, 'glob', 'glob'));
    rmSync(join(root, 'docs/a/one.md'));
    const removed = (await report(root, 'glob', 'glob')); assert.notEqual(old.receipt!.writeDigest, removed.receipt!.writeDigest); assert.ok(removed.receipt!.changedPaths.includes('docs/a/one.md'));
    assert.equal(existsSync(join(prepared.statePath!, 'receipts/glob.reported.json')), true);
    const scopeDuplicate = (await prepare(root, { runId: 'duplicate', scopes: ['docs/a', 'other/a'] }, 1));
    assert.ok(scopeDuplicate.details!.problems!.some(p => p.code === 'DuplicateItemId'));
    const badBase = (await prepare(root, { base: 'missing-commit', runId: 'base', scopes: ['other/'] }, 1)); assert.ok(badBase.details!.problems!.some(p => p.code === 'BaseNotAncestor'));
    assert.equal((await prepare(root, { runId: 'escape', scopes: ['../escape'] }, 1)).error, 'DocsWorkPlanInvalid');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('prepare rejects nonancestor commits and glob limits without publishing a run', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = fixture(custom);
  try {
    const unrelated = git(root, 'commit-tree', 'HEAD^{tree}', '-m', 'unrelated root');
    const rejected = (await prepare(root, { base: unrelated, runId: 'unrelated', scopes: ['docs/a/'] }, 1));
    assert.ok(rejected.details!.problems!.some(problem => problem.code === 'BaseNotAncestor'));
    mkdirSync(join(root, 'bulk'));
    for (let n = 0; n <= 10000; n++) writeFileSync(join(root, `bulk/${n}.md`), '# Page\n');
    git(root, 'add', 'bulk'); git(root, 'commit', '-qm', 'large scope');
    const limited = (await prepare(root, { runId: 'limit', scopes: ['bulk/'] }, 1));
    assert.ok(limited.details!.problems!.some(problem => problem.code === 'GlobLimit'));
    assert.equal(existsSync(join(root, '.git/concord/docs-work/v1/limit')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
