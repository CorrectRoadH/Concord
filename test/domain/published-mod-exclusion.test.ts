import { createConsumer } from '../support/consumer.ts';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import project from '../../concord.config.ts';
import { checkProject } from '../../src/app/index.ts';
import { scanCode } from '../../src/domain/code/index.ts';
import { scanAnnotations } from '../../src/domain/tests/index.ts';
import { LocalRepository } from '../support/repository.ts';
import { writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('published mod files stay outside Concord source, tests and document checks', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await createConsumer());
  try {
    writeProjectConfig(root, project);
    const inspect = async () => {
      const repo = (await LocalRepository.open(root));
      try {
        const checked = (await checkProject(repo, 'off'));
        return { ok: checked.ok, complete: checked.complete, findings: checked.findings, documents: checked.documents,
          cases: checked.cases, codeDeclarations: checked.codeDeclarations,
          sourceFiles: (await scanCode(repo, { cache: 'off' })).files, testFiles: (await scanAnnotations(repo, { cache: 'off' })).files };
      } finally { repo.close(); }
    };
    const before = (await inspect());
    for (const [path, text] of [
      ['concord/mods/concord/main.js', '// @concord-file\n// @concord-implements docs/feature/missing/README.md\nexport const generated = true;'],
      ['concord/test/decoy.test.ts', '// @feature docs/feature/missing/README.md\ntest("generated", () => {});'],
      ['concord/RECIPE.md', '# Generated recipe\n[Broken](missing.md)\n'],
      ['concord/docs/feature/missing/README.md', '---\ninvalid: managed document\n---\n'],
    ]) { const target = join(root, path!); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text!); }
    assert.equal(before.ok, true);
    assert.deepEqual((await inspect()), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

