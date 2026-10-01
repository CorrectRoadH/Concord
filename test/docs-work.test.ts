// @use-case docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';

const cli = process.env.CONCORD_DOCS_WORK_CLI ?? resolve('dist/entry.js');
interface Output { operation?: string; runId?: string; statePath?: string; error?: string; details?: { problems?: { code: string; path?: string }[] }; receiptDigest?: string; receipt?: { status: string; writeDigest: string; changedPaths: string[]; checks: { status: string; exitCode: number | null; summary: string }[] }; status?: string; blocked?: { itemId: string; reason: string }[] }
function git(root: string, ...args: string[]) { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); }
function call(root: string, args: readonly string[], status = 0, input?: string): Output {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', 'docs', 'work', ...args], { cwd: root, encoding: 'utf8', timeout: 30000, input });
  assert.equal(result.status, status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(status === 1 && result.stderr ? result.stderr : result.stdout) as Output;
}
function fixture(docsWork?: unknown, initialConfig = true) {
  const root = mkdtempSync(join(tmpdir(), 'concord-docs-work-'));
  git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Docs Work'); git(root, 'config', 'user.email', 'docs-work@example.test');
  mkdirSync(join(root, 'docs/a'), { recursive: true }); mkdirSync(join(root, 'docs/b'));
  writeFileSync(join(root, 'docs/a/one.md'), '# One\n\nClear text.\n'); writeFileSync(join(root, 'docs/b/two.md'), '# Two\n\nClear text.\n');
  writeFileSync(join(root, 'docs/README.md'), '# Documentation\n');
  writeFileSync(join(root, 'docs/input.md'), '# Input\n'); writeFileSync(join(root, 'outside.txt'), 'Outside\n');
  if (initialConfig) writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ format: 'concord.project/v1', projectId: 'docs-work', testRoots: [], sourceRoots: [], runner: { kind: 'command', argv: [process.execPath, '-e', 'process.exit(0)'], sourceFiles: [], timeoutMs: 1000 }, ...(docsWork === undefined ? {} : { docsWork }) })} as const;\n`);
  writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify({ format: 'concord.writing/v2', bannedTerms: [], paragraphLength: 200, sentenceLength: 100 }));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture');
  return root;
}
function waitingProcess(childPidPath: string, groupPidPath?: string): string {
  const descendant = 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)';
  return `const {spawn}=require("node:child_process");const fs=require("node:fs");const child=spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:"ignore"});fs.writeFileSync(${JSON.stringify(childPidPath)},String(child.pid));${groupPidPath === undefined ? '' : `fs.writeFileSync(${JSON.stringify(groupPidPath)},String(process.pid));`}process.on("SIGTERM",()=>{});setInterval(()=>{},1000)`;
}
const custom = { checks: { ok: { argv: [process.execPath, '-e', 'const fs=require("node:fs");fs.writeFileSync("check-count",String(Number(fs.existsSync("check-count")?fs.readFileSync("check-count","utf8"):0)+1));console.log(process.argv.slice(1).join("|"))', '{paths}'] }, failed: { argv: [process.execPath, '-e', 'const fs=require("node:fs");fs.writeFileSync("failed-count",String(Number(fs.existsSync("failed-count")?fs.readFileSync("failed-count","utf8"):0)+1));console.log("failed output");process.exit(7)'] } }, finalizer: { argv: [process.execPath, '-e', 'const fs=require("node:fs");fs.writeFileSync("finalizer-count",String(Number(fs.existsSync("finalizer-count")?fs.readFileSync("finalizer-count","utf8"):0)+1));console.log("finalized")'] } };
function plan(root: string, items: unknown[], runId: string) {
  const path = join(tmpdir(), `docs-work-plan-${process.pid}-${runId}.json`);
  writeFileSync(path, JSON.stringify({ format: 'concord.docs-work-plan/v1', items }));
  try { return call(root, ['prepare', '--plan', path, '--run-id', runId]); } finally { rmSync(path); }
}
const item = (id: string, write: string[], rest: Record<string, unknown> = {}) => ({ id, goal: `Update ${id}`, write, checks: ['ok'], ...rest });
const report = (root: string, run: string, id: string) => call(root, ['check', run, id, '--report']);
const verify = (root: string, run: string, id: string, digest: string) => call(root, ['check', run, id, '--verify', digest]);

test('C5/C6 public CLI dynamically owns directory writes and binds verified dependency receipts', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(custom);
  try {
    writeFileSync(join(root, 'outside.txt'), 'Unrelated change\n');
    const prepared = plan(root, [item('a', ['docs/a/']), item('b', ['docs/b/'], { read: ['docs/a/'], blockedBy: ['a'] })], 'dependencies');
    assert.match(prepared.statePath!, /concord\/docs-work\/v1\/dependencies$/);
    const a = report(root, 'dependencies', 'a');
    const b = report(root, 'dependencies', 'b');
    const unverified = call(root, ['check', 'dependencies', 'b', '--verify', b.receiptDigest!], 1);
    assert.equal(unverified.error, 'DocsWorkDependencyUnverified');
    const blocked = call(root, ['finalize', 'dependencies'], 1); assert.equal(blocked.status, 'blocked');
    writeFileSync(join(root, 'docs/a/new.md'), '# New page\n');
    const dynamic = report(root, 'dependencies', 'a');
    assert.notEqual(dynamic.receipt!.writeDigest, a.receipt!.writeDigest);
    assert.ok(dynamic.receipt!.changedPaths.includes('docs/a/new.md'));
    assert.match(dynamic.receipt!.checks[0]!.summary, /docs\/a\/new.md/);
    assert.equal(call(root, ['check', 'dependencies', 'a', '--verify', a.receiptDigest!], 1).error, 'DocsWorkReceiptMismatch');
    verify(root, 'dependencies', 'a', dynamic.receiptDigest!);
    verify(root, 'dependencies', 'b', b.receiptDigest!);
    verify(root, 'dependencies', 'a', dynamic.receiptDigest!);
    const stale = call(root, ['finalize', 'dependencies'], 1); assert.equal(stale.status, 'blocked'); assert.ok(stale.blocked!.some(entry => entry.itemId === 'b'));
    verify(root, 'dependencies', 'b', b.receiptDigest!);
    const originalB = readFileSync(join(root, 'docs/b/two.md'), 'utf8');
    writeFileSync(join(root, 'docs/b/two.md'), '# Changed write after verification\n');
    assert.equal(call(root, ['finalize', 'dependencies'], 1).status, 'blocked');
    writeFileSync(join(root, 'docs/b/two.md'), originalB);
    assert.equal(call(root, ['finalize', 'dependencies']).status, 'finalized');
    assert.equal(call(root, ['finalize', 'dependencies'], 1).error, 'DocsWorkFinalized');
    assert.equal(readFileSync(join(root, 'finalizer-count'), 'utf8'), '1');
    assert.equal(call(root, ['show', 'dependencies']).runId, 'dependencies');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('C5 prepare aggregates dirty paths, overlaps, duplicate IDs, dependencies, cycles and unknown checks with zero state writes', () => Effect.runPromise(Effect.sync(() => {
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
    const result = call(root, ['prepare', '--plan', path, '--run-id', 'invalid'], 1);
    assert.equal(result.error, 'DocsWorkPlanInvalid');
    const codes = new Set(result.details!.problems!.map(problem => problem.code));
    for (const code of ['DirtyPath', 'WriteOverlap', 'DuplicateItemId', 'UndeclaredDependency', 'DependencyCycle', 'UnknownDependency', 'UnknownCheck', 'SharedPathWrite', 'EmptyWrite', 'EmptyRead']) assert.ok(codes.has(code), code);
    assert.equal(existsSync(join(root, '.git/concord/docs-work/v1/invalid')), false);
  } finally { rmSync(path, { force: true }); rmSync(root, { recursive: true, force: true }); }
})));

test('C5/C6 failed reports persist; read and configuration drift reject without running checks', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(custom);
  try {
    const prepared = plan(root, [item('failed', ['docs/a/'], { checks: ['failed'] }), item('reader', ['docs/b/'], { read: ['docs/input.md'] })], 'drift');
    const failed = call(root, ['check', 'drift', 'failed', '--report'], 1);
    assert.equal(failed.receipt!.checks[0]!.status, 'failed'); assert.equal(failed.receipt!.checks[0]!.exitCode, 7);
    assert.ok(existsSync(join(prepared.statePath!, 'receipts/failed.reported.json')));
    assert.equal(call(root, ['check', 'drift', 'failed', '--verify', failed.receiptDigest!], 1).error, 'DocsWorkReceiptMismatch');
    writeFileSync(join(root, 'docs/input.md'), '# Changed input\n');
    assert.equal(call(root, ['check', 'drift', 'reader', '--report'], 1).error, 'DocsWorkReadChanged');
    assert.equal(existsSync(join(prepared.statePath!, 'receipts/reader.reported.json')), false);
    writeFileSync(join(root, 'docs/README.md'), '# Shared changed\n');
    assert.equal(call(root, ['check', 'drift', 'failed', '--report'], 1).error, 'DocsWorkReadChanged');
    const configPath = join(root, 'concord.config.ts'); writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}\n`);
    assert.equal(call(root, ['check', 'drift', 'failed', '--report'], 1).error, 'DocsWorkConfigChanged');
    assert.equal(readFileSync(join(root, 'failed-count'), 'utf8'), '1');
    assert.equal(call(root, ['finalize', 'drift'], 1).error, 'DocsWorkConfigChanged');
    writeFileSync(configPath, 'export default {broken:}');
    assert.equal(call(root, ['check', 'drift', 'failed', '--report'], 1).error, 'DocsWorkConfigChanged');
    assert.equal(readFileSync(join(root, 'failed-count'), 'utf8'), '1');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('scope prepare, exclusive locking, temporary cleanup, symlink rejection and strict config schema', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(custom);
  try {
    const run = call(root, ['prepare', '--scope', 'docs/a', '--run-id', 'scope']);
    assert.equal(call(root, ['prepare', '--scope', 'docs/a', '--run-id', 'scope'], 1).error, 'DocsWorkRunExists');
    writeFileSync(join(run.statePath!, 'lock'), '');
    assert.equal(call(root, ['check', 'scope', 'a', '--report'], 1).error, 'DocsWorkBusy');
    rmSync(join(run.statePath!, 'lock'));
    writeFileSync(join(run.statePath!, '.tmp-abandoned'), 'partial');
    report(root, 'scope', 'a'); assert.equal(existsSync(join(run.statePath!, '.tmp-abandoned')), false);
    symlinkSync(join(root, 'docs/a'), join(root, 'linked'));
    assert.equal(call(root, ['prepare', '--scope', 'linked/', '--run-id', 'unsafe'], 1).error, 'DocsWorkPlanInvalid');
    assert.ok(readdirSync(run.statePath!).includes('run.json'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('default writing uses main CLI rules on item paths and default finalizer calls checkProject', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(undefined, false);
  try {
    // `init` creates valid project contract owners for the aggregate finalizer.
    const initialized = spawnSync(process.execPath, [cli, '--root', root, '--json', 'init', '--docs-only', '--yes'], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(initialized.status, 0, initialized.stderr);
    writeFileSync(join(root, 'docs/concord-writing.json'), JSON.stringify({ format: 'concord.writing/v2', roots: ['docs/a', 'docs/b'], bannedTerms: [{ term: 'Forbidden', use: 'Allowed', why: 'Fixture rule' }] }));
    git(root, 'add', '.'); git(root, 'commit', '-qm', 'initialized');
    const run = call(root, ['prepare', '--scope', 'docs/a/', '--run-id', 'builtin']);
    writeFileSync(join(root, 'docs/a/one.md'), '# One\n\nForbidden text.\n');
    const failed = call(root, ['check', 'builtin', 'a', '--report'], 1); assert.equal(failed.receipt!.checks[0]!.status, 'failed');
    writeFileSync(join(root, 'docs/a/one.md'), '# One\n\nAllowed text.\n');
    writeFileSync(join(root, 'docs/b/two.md'), '# Two\n\nForbidden text.\n');
    const passed = report(root, 'builtin', 'a'); verify(root, 'builtin', 'a', passed.receiptDigest!);
    const result = call(root, ['finalize', 'builtin'], 1); assert.equal(result.status, 'failed');
    assert.match(readFileSync(join(run.statePath!, 'finalize.json'), 'utf8'), /Forbidden/);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('process argv is literal, timed-out groups are killed and argv budgets are named', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture({ checks: {
    literal: { argv: [process.execPath, '-e', 'console.log(process.argv[1])', '$(touch should-not-exist)'] },
    unicode: { argv: [process.execPath, '-e', 'console.log("文".repeat(3000))'] },
    timeout: { argv: [process.execPath, '-e', waitingProcess('child.pid')], timeoutMs: 5000 },
    long: { argv: [process.execPath, '-e', 'process.exit(0)', 'x'.repeat(128 * 1024)] },
  }, finalizer: { argv: [process.execPath, '-e', 'process.exit(2)'] } });
  try {
    plan(root, [item('literal', ['docs/a/'], { checks: ['literal'] }), item('timeout', ['docs/b/'], { checks: ['timeout'] }), item('long', ['docs/c/'], { checks: ['long'] }), item('unicode', ['docs/d/'], { checks: ['unicode'] })], 'process');
    const unicode = report(root, 'process', 'unicode'); assert.ok(Buffer.byteLength(unicode.receipt!.checks[0]!.summary) <= 4096);
    const literal = report(root, 'process', 'literal'); assert.match(literal.receipt!.checks[0]!.summary, /\$\(touch/); assert.equal(existsSync(join(root, 'should-not-exist')), false);
    const timed = call(root, ['check', 'process', 'timeout', '--report'], 1); assert.equal(timed.receipt!.checks[0]!.exitCode, null, timed.receipt!.checks[0]!.summary);
    assert.ok(existsSync(join(root, 'child.pid')), 'timed check must start and record its descendant before cleanup is asserted');
    const pid = readFileSync(join(root, 'child.pid'), 'utf8');
    if (process.platform === 'linux' && existsSync(`/proc/${pid}/stat`)) assert.match(readFileSync(`/proc/${pid}/stat`, 'utf8').slice(readFileSync(`/proc/${pid}/stat`, 'utf8').lastIndexOf(')') + 1), /^\s+[ZX]\s/u);
    else assert.throws(() => process.kill(Number(pid), 0));
    assert.equal(call(root, ['check', 'process', 'long', '--report'], 1).error, 'DocsWorkArgvTooLong');
    const finalRun = plan(root, [item('final', ['docs/a/'], { checks: ['literal'] })], 'failed-finalizer');
    const finalReport = report(root, 'failed-finalizer', 'final'); verify(root, 'failed-finalizer', 'final', finalReport.receiptDigest!);
    assert.equal(call(root, ['finalize', 'failed-finalizer'], 1).status, 'failed');
    assert.equal(call(root, ['finalize', 'failed-finalizer'], 1).status, 'failed');
    assert.ok(existsSync(join(finalRun.statePath!, 'finalize.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('glob ownership includes deletes, conservative prefixes overlap, paths and base commits are validated', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(custom);
  try {
    const prepared = plan(root, [item('glob', ['docs/a/**/*.md'])], 'glob');
    const old = report(root, 'glob', 'glob');
    rmSync(join(root, 'docs/a/one.md'));
    const removed = report(root, 'glob', 'glob'); assert.notEqual(old.receipt!.writeDigest, removed.receipt!.writeDigest); assert.ok(removed.receipt!.changedPaths.includes('docs/a/one.md'));
    assert.equal(existsSync(join(prepared.statePath!, 'receipts/glob.reported.json')), true);
    const scopeDuplicate = call(root, ['prepare', '--scope', 'docs/a', '--scope', 'other/a', '--run-id', 'duplicate'], 1);
    assert.ok(scopeDuplicate.details!.problems!.some(p => p.code === 'DuplicateItemId'));
    const badBase = call(root, ['prepare', '--scope', 'other/', '--base', 'missing-commit', '--run-id', 'base'], 1); assert.ok(badBase.details!.problems!.some(p => p.code === 'BaseNotAncestor'));
    assert.equal(call(root, ['prepare', '--scope', '../escape', '--run-id', 'escape'], 1).error, 'DocsWorkPlanInvalid');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('stdin plans and trailing shared CLI flags work; verification re-runs checks and preserves failed output', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture({ checks: { once: { argv: [process.execPath, '-e', 'const fs=require("node:fs");const n=fs.existsSync("attempt")?1:0;fs.writeFileSync("attempt","x");console.log("attempt "+n);process.exit(n)'] } }, finalizer: custom.finalizer });
  try {
    const input = JSON.stringify({ format: 'concord.docs-work-plan/v1', items: [item('once', ['docs/a/'], { checks: ['once'] })] });
    const prepared = call(root, ['prepare', '--plan', '-', '--run-id', 'stdin'], 0, input);
    const reported = report(root, 'stdin', 'once');
    const failed = call(root, ['check', 'stdin', 'once', '--verify', reported.receiptDigest!], 1);
    assert.equal(failed.receipt!.status, 'reported'); assert.equal(failed.receipt!.checks[0]!.status, 'failed'); assert.match(failed.receipt!.checks[0]!.summary, /attempt 1/);
    assert.equal(existsSync(join(prepared.statePath!, 'receipts/once.verified.json')), false);
    const trailing = spawnSync(process.execPath, [cli, 'docs', 'work', 'show', 'stdin', '--root', root, '--json'], { cwd: tmpdir(), encoding: 'utf8', timeout: 30000 });
    assert.equal(trailing.status, 0, trailing.stderr); assert.equal(trailing.stdout.trim().split('\n').length, 1);
    assert.equal((JSON.parse(trailing.stdout) as Output).runId, 'stdin');
    assert.equal(call(root, ['prepare', '--plan', '-', '--run-id', 'malformed'], 1, '{broken').error, 'DocsWorkPlanInvalid');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('prepare rejects nonancestor commits and glob limits without publishing a run', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(custom);
  try {
    const unrelated = git(root, 'commit-tree', 'HEAD^{tree}', '-m', 'unrelated root');
    const rejected = call(root, ['prepare', '--scope', 'docs/a/', '--base', unrelated, '--run-id', 'unrelated'], 1);
    assert.ok(rejected.details!.problems!.some(problem => problem.code === 'BaseNotAncestor'));
    mkdirSync(join(root, 'bulk'));
    for (let n = 0; n <= 10000; n++) writeFileSync(join(root, `bulk/${n}.md`), '# Page\n');
    git(root, 'add', 'bulk'); git(root, 'commit', '-qm', 'large scope');
    const limited = call(root, ['prepare', '--scope', 'bulk/', '--run-id', 'limit'], 1);
    assert.ok(limited.details!.problems!.some(problem => problem.code === 'GlobLimit'));
    assert.equal(existsSync(join(root, '.git/concord/docs-work/v1/limit')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('cancelling public CLI reclaims the detached check group and releases the run lock', () => Effect.runPromise(Effect.gen(function*() {
  const root = yield* Effect.sync(() => fixture({ checks: { wait: { argv: [process.execPath, '-e', waitingProcess('cancel-child.pid', 'cancel-group.pid')] } }, finalizer: custom.finalizer }));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const prepared = yield* Effect.sync(() => plan(root, [item('wait', ['docs/a/'], { checks: ['wait'] })], 'cancel'));
    child = yield* Effect.sync(() => spawn(process.execPath, [cli, '--root', root, '--json', 'docs', 'work', 'check', 'cancel', 'wait', '--report'], { cwd: root, stdio: 'ignore' }));
    for (let attempt = 0; attempt < 200 && !existsSync(join(root, 'cancel-child.pid')); attempt++) yield* Effect.sleep(25);
    assert.ok(existsSync(join(root, 'cancel-child.pid')), 'check child must start before cancellation');
    const running = child;
    yield* Effect.callback<void>(resume => {
      const onClose = () => resume(Effect.void);
      running.once('close', onClose);
      running.kill('SIGINT');
      return Effect.sync(() => running.off('close', onClose));
    }).pipe(Effect.timeout(10000));
    yield* Effect.sync(() => {
      assert.equal(existsSync(join(prepared.statePath!, 'lock')), false);
      assert.equal(existsSync(join(prepared.statePath!, 'receipts/wait.reported.json')), false);
      const pid = readFileSync(join(root, 'cancel-child.pid'), 'utf8');
      if (process.platform === 'linux' && existsSync(`/proc/${pid}/stat`)) {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); assert.match(stat.slice(stat.lastIndexOf(')') + 1), /^\s+[ZX]\s/u);
      } else assert.throws(() => process.kill(Number(pid), 0));
    });
  } finally {
    yield* Effect.sync(() => {
      if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (existsSync(join(root, 'cancel-group.pid'))) { try { process.kill(-Number(readFileSync(join(root, 'cancel-group.pid'), 'utf8')), 'SIGKILL'); } catch { /* already reaped */ } }
      rmSync(root, { recursive: true, force: true });
    });
  }
})));

test('config set/show round-trip docsWork and reject malformed commands without changing the owner', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(custom);
  const input = join(tmpdir(), `docs-work-config-${process.pid}.json`);
  try {
    const show = () => {
      const result = spawnSync(process.execPath, [cli, '--root', root, '--json', 'config', 'show'], { cwd: root, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout) as { config: Record<string, unknown>; digest: string };
    };
    const current = show(); assert.deepEqual(current.config.docsWork, custom);
    const source = readFileSync(join(root, 'concord.config.ts'), 'utf8');
    for (const docsWork of [{ checks: { invalid: { argv: [] } } }, { finalizer: { argv: [process.execPath], timeoutMs: 0 } }, { unsupported: true }]) {
      writeFileSync(input, JSON.stringify({ ...current.config, docsWork }));
      const rejected = spawnSync(process.execPath, [cli, '--root', root, '--json', 'config', 'set', '--input', input, '--expected-digest', current.digest], { cwd: root, encoding: 'utf8', timeout: 30000 });
      assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr); assert.equal((JSON.parse(rejected.stderr) as Output).error, 'InvalidData');
      assert.equal(readFileSync(join(root, 'concord.config.ts'), 'utf8'), source);
    }
    const configured = { ...custom, sharedPaths: ['docs/README.md'], finalizer: { ...custom.finalizer, timeoutMs: 2000 } };
    writeFileSync(input, JSON.stringify({ ...current.config, docsWork: configured }));
    const saved = spawnSync(process.execPath, [cli, '--root', root, '--json', 'config', 'set', '--input', input, '--expected-digest', current.digest], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(saved.status, 0, saved.stderr); assert.deepEqual(show().config.docsWork, configured);
  } finally { rmSync(input, { force: true }); rmSync(root, { recursive: true, force: true }); }
})));
