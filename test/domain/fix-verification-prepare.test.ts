import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { closeFixedIssue, replayFix, runCommandCase, scanAnnotations } from '../../src/domain/tests/index.js';
import { readDocumentSelector } from '../../src/domain/documents/index.js';
import { createFixConsumer, gitCommit } from '../support/fix-consumer.js';
import { LocalRepository, runApplication } from '../support/repository.js';
import { readProjectConfig, writeProjectConfig } from '../support/support.js';
import { parseTypeScriptConfig } from '../../src/base/workspace/index.js';

const setPrepare = (root: string, prepare: readonly (readonly [string, ...string[]])[]) => {
  const config = readProjectConfig(root);
  assert.ok(config.runner);
  writeProjectConfig(root, { ...config, runner: { ...config.runner, prepare } });
};
const verify = (root: string, defect: string) => {
  const repo = new LocalRepository(root, { optimistic: true });
  return runApplication(closeFixedIssue(repo, 'sku', 'Accumulate quantity', defect)).finally(() => repo.close());
};

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('static configuration accepts prepare argv lists and rejects empty commands and non-string arguments', () => {
  const runner = { kind: 'node-test', sourceFiles: [], timeoutMs: 1000 };
  for (const prepare of [[], [['node', '-e', 'process.exit(0)']]]) {
    assert.deepEqual(parseTypeScriptConfig(`export default ${JSON.stringify({ runner: { ...runner, prepare } })};`).runner?.prepare, prepare);
  }
  for (const prepare of ['node build', ['node build'], [[]], [['']], [['node', 3]]]) {
    assert.throws(() => parseTypeScriptConfig(`export default ${JSON.stringify({ runner: { ...runner, prepare } })};`), { code: 'InvalidData' });
  }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('verification prepares both checkouts in order using only the fix candidate commands and replays them', async () => {
  const f = createFixConsumer();
  try {
    const ignore = join(f.root, '.gitignore');
    writeFileSync(ignore, (existsSync(ignore) ? readFileSync(ignore, 'utf8') : '') + '\npreparation.log\n');
    const testPath = join(f.root, 'test/cart.test.ts');
    writeFileSync(testPath, readFileSync(testPath, 'utf8') + '\nimport { prepared } from "../prepared.ts";\nassert.equal(prepared, true);\n');
    setPrepare(f.root, [[process.execPath, '-e', 'process.exit(17)']]);
    const defect = gitCommit(f.root, 'regression needs prepared dependency');
    const log = join(f.root, 'preparation.log');
    setPrepare(f.root, [
      [process.execPath, '-e', `const fs = require('node:fs'); fs.writeFileSync('preparation-stage', 'ready'); fs.appendFileSync(${JSON.stringify(log)}, process.cwd() + '\\n');`],
      [process.execPath, '-e', "const fs = require('node:fs'); if (fs.readFileSync('preparation-stage', 'utf8') !== 'ready') process.exit(9); fs.writeFileSync('prepared.ts', 'export const prepared = true;\\n');"],
    ]);
    const fix = f.fix();
    await verify(f.root, defect);
    assert.equal(existsSync(join(f.root, 'prepared.ts')), false, 'prepare must not run in the current worktree');
    const roots = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(roots.length, 2);
    assert.ok(roots.every(root => root !== f.root && !existsSync(root)), 'both temporary checkouts are removed');
    const repo = new LocalRepository(f.root, { optimistic: true });
    try {
      const issue = readDocumentSelector(repo, 'sku', 'issue');
      if (issue.metadata.kind !== 'issue' || issue.metadata.closure?.kind !== 'fixed') assert.fail('Expected verified Issue');
      assert.equal(issue.metadata.closure.verification?.fix, fix);
      assert.equal((await runApplication(replayFix(repo, 'sku'))).verified, 'replayed');
      assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 4);
    } finally { repo.close(); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('nonzero, timed out and signalled preparation cannot count as the failing regression', async t => {
  for (const [name, program, timeoutMs] of [
    ['nonzero', 'process.exit(7)', 5000],
    ['timeout', 'setInterval(() => {}, 1000)', 50],
    ['signal', 'process.kill(process.pid, "SIGTERM")', 5000],
  ] as const) await t.test(name, async () => {
    const f = createFixConsumer();
    try {
      const config = readProjectConfig(f.root);
      writeProjectConfig(f.root, { ...config, runner: { ...config.runner!, timeoutMs, prepare: [[process.execPath, '-e', program]] } });
      const defect = gitCommit(f.root, 'prepare environment');
      f.fix();
      const path = join(f.root, 'docs/issues/sku.md');
      const before = readFileSync(path, 'utf8');
      await assert.rejects(verify(f.root, defect), cause => {
        assert.equal((cause as { code: string }).code, 'FixUnverifiable');
        assert.match((cause as Error).message, /prepar/iu);
        return true;
      });
      assert.equal(readFileSync(path, 'utf8'), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('configuration whitespace and prepare-only changes preserve frozen inputs but other project configuration changes do not', async t => {
  for (const change of ['whitespace', 'prepare', 'sourceRoots'] as const) await t.test(change, async () => {
    const f = createFixConsumer();
    try {
      if (change === 'whitespace') writeFileSync(join(f.root, 'concord.config.ts'), readFileSync(join(f.root, 'concord.config.ts'), 'utf8') + '\n\n');
      else if (change === 'prepare') setPrepare(f.root, [[process.execPath, '-e', 'process.exit(0)']]);
      else writeProjectConfig(f.root, { ...readProjectConfig(f.root), sourceRoots: ['src', 'other'] });
      gitCommit(f.root, 'project configuration edit'); f.fix();
      if (change === 'sourceRoots') await assert.rejects(verify(f.root, f.defect), cause => (cause as { code: string }).code === 'FixUnverifiable');
      else await verify(f.root, f.defect);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('test run executes its runner in the current worktree without executing prepare', async () => {
  const f = createFixConsumer();
  try {
    setPrepare(f.root, [[process.execPath, '-e', 'require("node:fs").writeFileSync("PREPARED", "bad"); process.exit(7)']]);
    f.fix();
    const repo = new LocalRepository(f.root, { optimistic: true });
    try {
      const selected = scanAnnotations(repo, { cache: 'off' }).cases[0]!;
      const outcome = await runApplication(runCommandCase(repo, selected, []));
      assert.equal(outcome.commandOutcome, 'pass');
      assert.equal(existsSync(join(f.root, 'PREPARED')), false);
    } finally { repo.close(); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
