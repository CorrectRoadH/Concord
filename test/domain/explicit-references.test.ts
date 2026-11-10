import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { checkProject } from '../../src/app/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from '../support/repository.ts';
import { writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md
test('check maps own GitHub blob links to worktree files and validates anchors', async t => {
  const root = await createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'git@github.com:Acme/Widgets.git']);
  writeProjectConfig(root, { testRoots: [], sourceRoots: [] });
  writeFileSync(join(root, 'docs/linked page.md'), '# Target {#target}\n');
  writeFileSync(join(root, 'docs/links.md'), [
    '# Links',
    '[valid](https://github.com/acme/widgets/blob/any-ref/docs/linked%20page.md#target)',
    '[missing](https://github.com/acme/widgets/blob/main/docs/missing.md)',
    '[anchor][broken]',
    '',
    '[broken]: https://github.com/acme/widgets/blob/main/docs/linked%20page.md#missing',
    '',
    '[foreign](https://github.com/other/widgets/blob/main/docs/missing.md)',
    '[non-blob](https://github.com/acme/widgets/issues/1)',
    '`[code](https://github.com/acme/widgets/blob/main/docs/missing.md)`',
  ].join('\n'));
  const repo = await LocalRepository.open(root);
  try {
    const result = await checkProject(repo, 'off');
    const findings = result.findings.filter(finding => finding.path === 'docs/links.md');
    assert.deepEqual(findings.map(({ code, line, category }) => ({ code, line, category })), [
      { code: 'ReferenceNotFound', line: 3, category: 'relation' },
      { code: 'AnchorNotFound', line: 4, category: 'relation' },
    ]);
    assert.equal(result.checks.relations.ok, false);
    assert.equal(result.checks.relations.complete, true);
  } finally { repo.close(); }
});

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md
test('check validates real source spec comments and excludes strings and templates', async t => {
  const root = await createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeProjectConfig(root, { testRoots: [], sourceRoots: ['src'] });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'docs/target.md'), '# Target {#target}\n\n```md\n# Fake\n```\n');
  writeFileSync(join(root, 'src/example.ts'), [
    '// @spec docs/target.md#target',
    '// @spec docs/missing.md#target',
    '// @spec docs/target.md#missing',
    'const text = "// @spec docs/missing-string.md";',
    'const template = `',
    '// @spec docs/missing-template.md',
    '`;',
    '/* // @spec docs/missing-block.md */',
    '// @spec docs/target.md#fake',
  ].join('\n'));
  const repo = await LocalRepository.open(root);
  try {
    const result = await checkProject(repo, 'off');
    assert.deepEqual(result.findings.filter(finding => finding.path === 'src/example.ts').map(({ code, line }) => ({ code, line })), [
      { code: 'ReferenceNotFound', line: 2 },
      { code: 'AnchorNotFound', line: 3 },
      { code: 'AnchorNotFound', line: 9 },
    ]);
  } finally { repo.close(); }
});
