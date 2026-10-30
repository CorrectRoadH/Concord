import { createFixConsumer as fixture, gitCommand as git, gitCommit as commit } from './support/fix-consumer.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effect } from 'effect';
import { createConsumer } from './support/consumer.js';
import { LocalRepository } from "./support/repository.js";
import { readDocumentSelector } from "../src/domain/documents/index.js";
import { createDocument } from "../src/app/index.js";
import { renderTypeScriptConfig } from "../src/base/workspace/index.js";
import { closeFixedIssue, replayFix } from "../src/domain/tests/index.js";
import { OwnedProcessLive } from "../src/base/process/index.js";
import { inspectEndpointEvents, checkSince } from "../src/app/index.js";

async function verify(root: string, defect?: string) {
  const repo = new LocalRepository(root, { optimistic: true });
  try { return await Effect.runPromise(closeFixedIssue(repo, 'sku', 'Accumulate quantity', defect).pipe(Effect.provide(OwnedProcessLive))); }
  finally { repo.close(); }
}
const code = (expected: string) => (cause: unknown) => { assert.equal((cause as { code: string }).code, expected); return true; };

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('linear failing-test then fix records verification and replays exact commits without writing', async () => {
  const f = fixture();
  try {
    const fix = f.fix(); await verify(f.root);
    const repo = new LocalRepository(f.root, { optimistic: true });
    try {
      const issue = readDocumentSelector(repo, 'sku', 'issue'); assert.equal(issue.metadata.kind, 'issue');
      if (issue.metadata.kind !== 'issue' || issue.metadata.closure?.kind !== 'fixed') assert.fail('Expected fixed Issue');
      assert.deepEqual({ defect: issue.metadata.closure.verification?.defect, fix: issue.metadata.closure.verification?.fix }, { defect: f.defect, fix });
      const source = readFileSync(join(f.root, issue.path), 'utf8');
      const replay = await Effect.runPromise(replayFix(repo, 'sku').pipe(Effect.provide(OwnedProcessLive)));
      assert.equal(replay.verified, 'replayed'); assert.equal(readFileSync(join(f.root, issue.path), 'utf8'), source);
      assert.equal(git(f.root, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1);
    } finally { repo.close(); }
    const checked = await Effect.runPromise(checkSince(f.root, f.defect).pipe(Effect.provide(OwnedProcessLive)));
    assert.deepEqual(checked.since, { base: f.defect, target: 'worktree', scope: 'endpoints' });
    assert.equal(checked.verifications[0]?.verified, 'replayed');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('commit verification refuses invalid candidate paths and changed frozen inputs', async t => {
  for (const [name, arrange, expected] of [
    ['dirty target', (f: ReturnType<typeof fixture>) => { f.fix(); writeFileSync(join(f.root, 'untracked'), 'x'); }, 'FixUnverifiable'],
    ['only runner input changed', (f: ReturnType<typeof fixture>) => { writeFileSync(join(f.root, 'concord.config.ts'), readFileSync(join(f.root, 'concord.config.ts'), 'utf8') + '\n'); commit(f.root, 'runner change'); f.fix(); }, 'FixUnverifiable'],
    ['test file changed', (f: ReturnType<typeof fixture>) => { writeFileSync(join(f.root, 'test/cart.test.ts'), readFileSync(join(f.root, 'test/cart.test.ts'), 'utf8') + '\n'); f.fix(); }, 'FixUnverifiable'],
    ['Spec changed', (f: ReturnType<typeof fixture>) => { writeFileSync(join(f.root, 'docs/feature/cart/README.md'), '# Cart\n\nChanged.\n'); f.fix(); }, 'FixUnverifiable'],
    ['unfixed green candidate', (_f: ReturnType<typeof fixture>) => {}, 'FixVerificationFailed'],
    ['merge interval', (f: ReturnType<typeof fixture>) => { git(f.root, 'branch', 'side'); f.fix(); git(f.root, 'switch', '-q', 'side'); writeFileSync(join(f.root, 'other'), 'x'); commit(f.root, 'side'); git(f.root, 'switch', '-q', 'master'); git(f.root, 'merge', '--no-ff', '-qm', 'merge', 'side'); }, 'FixUnverifiable'],
  ] as const) await t.test(name, async () => {
    const f = fixture(); try { arrange(f); await assert.rejects(verify(f.root), code(expected)); assert.equal(readDocumentSelector(new LocalRepository(f.root), 'sku', 'issue').metadata.kind, 'issue'); }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('explicit missing or non-first-parent defect and shallow history are unverifiable', async () => {
  const f = fixture(); try {
    f.fix(); await assert.rejects(verify(f.root, '0'.repeat(40)), code('FixUnverifiable'));
    const shallow = `${f.root}-shallow`;
    git(f.root, 'clone', '-q', '--depth=1', `file://${f.root}`, shallow);
    try { await assert.rejects(verify(shallow), code('FixUnverifiable')); } finally { rmSync(shallow, { recursive: true, force: true }); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('runner and history rejection table preserves Issue bytes', async t => {
  for (const [name, options, expected] of [
    ['tests and fix in one commit', { greenAtDefect: true }, 'FixUnverifiable'],
    ['runner timeout', { runner: 'timeout' }, 'FixUnverifiable'],
    ['zero observed execution', { runner: 'zero' }, 'FixUnverifiable'],
    ['all tests skipped', { runner: 'skipped' }, 'FixUnverifiable'],
    ['signal termination', { runner: 'signal' }, 'FixUnverifiable'],
    ['HEAD changes during green', { runner: 'move-head' }, 'PreimageChanged'],
  ] as const) await t.test(name, async () => {
    const f = fixture(options); try {
      if (!('greenAtDefect' in options && options.greenAtDefect)) f.fix();
      const before = readFileSync(join(f.root, 'docs/issues/sku.md'), 'utf8');
      await assert.rejects(verify(f.root), code(expected));
      assert.equal(readFileSync(join(f.root, 'docs/issues/sku.md'), 'utf8'), before);
      assert.equal(git(f.root, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('runner source changes and fixes introduced then reverted inside the interval cannot qualify', async t => {
  await t.test('sourceFiles bytes changed', async () => {
    const f = fixture({ runnerSource: true }); try { writeFileSync(join(f.root, 'runner.ts'), '// changed\n'); f.fix(); await assert.rejects(verify(f.root), code('FixUnverifiable')); }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  await t.test('historical green defect', async () => {
    const f = fixture(); try { const historicalFix = f.fix(); writeFileSync(join(f.root, 'src/cart.ts'), 'export const quantity = 3;\n'); commit(f.root, 'later'); await assert.rejects(verify(f.root, historicalFix), code('FixUnverifiable')); }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('frozen runner sources compare actual bytes rather than lossy UTF-8 text', async () => {
  const f = fixture({ runnerSource: true });
  try {
    writeFileSync(join(f.root, 'runner.ts'), Buffer.from([0x80]));
    const defect = commit(f.root, 'binary runner input');
    writeFileSync(join(f.root, 'runner.ts'), Buffer.from([0x81])); f.fix();
    await assert.rejects(verify(f.root, defect), code('FixUnverifiable'));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('checkout normalization cannot change the frozen runner inputs used for red', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, '.gitattributes'), 'test/cart.test.ts text eol=crlf\n');
    const defect = commit(f.root, 'declare checkout normalization'); f.fix();
    await assert.rejects(verify(f.root, defect), code('FixUnverifiable'));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
