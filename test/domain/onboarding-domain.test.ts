import { createDocument, initialize } from '../support/operations.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';

import { parseTypeScriptConfig } from "../../src/base/workspace/index.ts";
import { LocalRepository } from "../support/repository.ts";


async function consumer(run: (root: string) => void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'concord-onboarding-'));
  try { execFileSync('git', ['init', '-q', root]); await run(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('optional configuration discovers existing conventional roots and explicit roots replace defaults', () => Effect.runPromise(Effect.tryPromise(async () => (await consumer(async root => {
  mkdirSync(join(root, 'test')); mkdirSync(join(root, 'src'));
  let repo = (await LocalRepository.open(root));
  try {
    assert.deepEqual(repo.config.testRoots, ['test']);
    assert.deepEqual(repo.config.sourceRoots, ['src']);
    assert.equal(repo.config.testAdapters, undefined);
    assert.deepEqual(repo.configSnapshot.config, {});
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
  } finally { repo.close(); }
  writeFileSync(join(root, 'concord.config.ts'), 'export default { testRoots: ["checks"], sourceRoots: [] };\n');
  repo = (await LocalRepository.open(root));
  try { assert.deepEqual(repo.config.testRoots, ['checks']); assert.deepEqual(repo.config.sourceRoots, []); }
  finally { repo.close(); }
})))));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('strict configuration rejects retired fields and runtime expressions', () => Effect.runPromise(Effect.tryPromise(async () => {
  for (const name of ['format', 'projectId', 'constitution', 'documentDefaults', 'projectTypes', 'memorySources', 'runner']) {
    (await assert.rejects(async () => (await parseTypeScriptConfig(`export default { ${name}: null };`)), { code: 'InvalidData' }));
  }
  (await assert.rejects(async () => (await parseTypeScriptConfig('export default { testRoots: getRoots() };')), { code: 'InvalidConfigSyntax' }));
  assert.deepEqual((await parseTypeScriptConfig('export default {};')), {});
  (await assert.rejects(async () => (await parseTypeScriptConfig('')), { code: 'InvalidConfigSyntax' }));
})));

// @use-case docs/feature/project-onboarding/use-case/initialize-project.md
test('init only writes configured overrides and emits current templates and direct-edit guidance', () => Effect.runPromise(Effect.tryPromise(async () => (await consumer(async root => {
  const repo = (await LocalRepository.open(root, { initialize: true }));
  try {
    (await initialize(repo));
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    const instructions = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.match(instructions, /Directly edit files/);
    assert.match(instructions, /check/);
    assert.doesNotMatch(instructions, /skill repository|Do not directly read or edit/);
    for (const path of ['docs/_template/memory/README.md', 'docs/_template/taste.md', 'docs/_template/design/README.md', 'memory/README.md']) assert.equal(existsSync(join(root, path)), true);
    const templateIndex = readFileSync(join(root, 'docs/_template/README.md'), 'utf8');
    for (const page of ['library', 'cli', 'api', 'format', 'ui', 'performance', 'architecture', 'data-model', 'use-case']) {
      assert.ok(templateIndex.includes(`| ${page} |`), `Missing page purpose: ${page}`);
      const path = page === 'use-case' ? 'use-case/README.md' : `${page}.md`;
      for (const owner of ['feature-design', 'engineering', 'roadmap']) {
        assert.equal(existsSync(join(root, `docs/_template/${owner}/${path}`)), true);
        assert.ok(readFileSync(join(root, `docs/_template/${owner}/README.md`), 'utf8').includes(`](${path})`));
      }
    }
    assert.doesNotMatch(templateIndex, /problem, mental model|supporting pages/u);
    for (const path of ['docs/_template/memory/problem.md', 'docs/_template/feature-design/lifecycle.md']) assert.equal(existsSync(join(root, path)), false);
    const minimal = (await createDocument(repo, 'feature', { id: 'minimal', title: 'Minimal' }));
    assert.deepEqual(minimal.changedPaths, ['docs/feature/minimal/README.md']);
    const explicit = (await createDocument(repo, 'feature', { id: 'explicit', title: 'Explicit', pages: ['cli'] }));
    assert.deepEqual(explicit.changedPaths, ['docs/feature/explicit/README.md', 'docs/feature/explicit/cli.md']);
  } finally { repo.close(); }
})))));
