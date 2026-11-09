import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runCli } from '../support/cli.ts';
import { LocalRepository } from '../../src/base/workspace/index.ts';
import { moveFixture, source, target, write } from '../support/document-move.ts';

async function call(root: string, from: string, to: string, options: readonly string[] = []) {
  return runCli({ cwd: root, env: process.env, argv: ['--root', root, '--json', ...options, 'move', from, to] });
}

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#preview
test('CLI move maps JSON and human preview output without publishing', async () => moveFixture(async root => {
  const result = await call(root, source, target, ['--dry-run']);
  assert.equal(result.exitCode, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.operation, 'move');
  assert.equal(output.dryRun, true);
  assert.deepEqual(output.moves, [{ from: source, to: target }]);
  const human = await runCli({ cwd: root, env: process.env, argv: ['--root', root, '--dry-run', 'move', source, target] });
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /^Would apply move:\n  docs\/feature\/a\/use-case\/one.md → docs\/feature\/b\/use-case\/two.md\n\nChanged:\n/u);
  assert.match(human.stdout, /\n\nNot rewritten:\n  notes.txt:2\n  notes.txt:3\n  test\/one.test.ts:3/u);
  assert.equal(existsSync(join(root, target)), false);
}));

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#apply
test('CLI move maps every input error row to exit 1 and never writes a partial move', async t => {
  const rows: readonly [string, string, string, string, ((root: string) => void)?][] = [
    ['missing source', 'docs/feature/a/use-case/missing.md', target, 'DocumentNotFound'],
    ['missing target package', source, 'docs/feature/missing/use-case/two.md', 'DocumentNotFound'],
    ['existing target file', source, source, 'DocumentExists'],
    ['existing target directory', 'docs/feature/a', 'docs/feature/b', 'DocumentExists'],
    ['wrong category', source, 'docs/roadmap/b/use-case/two.md', 'InvalidInput'],
    ['selector', 'one', target, 'InvalidInput'],
    ['package README', 'docs/feature/a/README.md', 'docs/feature/b/other.md', 'InvalidInput'],
    ['Use Case conversion', source, 'docs/feature/b/cli.md', 'InvalidInput'],
    ['invalid placement', source, 'docs/feature/b/use-case/invalid_name.md', 'InvalidPlacement'],
    ['unknown page kind', 'docs/feature/a/cli.md', 'docs/feature/b/not-a-kind.md', 'InvalidPlacement', root => write(root, 'docs/feature/a/cli.md', '# CLI\n')],
    ['source split entry', 'docs/feature/a/cli/README.md', 'docs/feature/b/cli.md', 'InvalidPlacement', root => { write(root, 'docs/feature/a/cli/README.md', '# CLI\n'); write(root, 'docs/feature/a/cli/part.md', '# Part\n'); }],
    ['target split conflict', 'docs/feature/a/cli.md', 'docs/feature/b/cli/README.md', 'InvalidPlacement', root => { write(root, 'docs/feature/a/cli.md', '# CLI\n'); write(root, 'docs/feature/b/cli.md', '# B CLI\n'); }],
    ['nested owner', 'docs/feature/a', 'docs/feature/renamed', 'NestedOwner', root => write(root, 'docs/feature/a/nested/README.md', '# Nested\n')],
    ['unsupported destination range', source, target, 'UnsupportedMarkdownLink', root => write(root, source, '# One\n\n![a [b]](../README.md)\n')],
    ['symlink source', 'docs/feature/a/use-case/link.md', target, 'UnsafePath', root => symlinkSync('one.md', join(root, 'docs/feature/a/use-case/link.md'))],
    ['symlink target', source, target, 'UnsafePath', root => { mkdirSync(dirname(join(root, target)), { recursive: true }); symlinkSync('../a/use-case/one.md', join(root, target)); }],
    ['symlink in package', 'docs/feature/a', 'docs/feature/renamed', 'UnsafePath', root => symlinkSync('picture.bin', join(root, 'docs/feature/a/assets/link.bin'))],
    ['traversal', source, '../outside.md', 'UnsafePath'],
  ];
  for (const [name, from, to, code, prepare] of rows) await t.test(name, async () => moveFixture(async root => {
    prepare?.(root);
    const before = readFileSync(join(root, source), 'utf8');
    const result = await call(root, from, to);
    assert.equal(result.exitCode, 1, `${name}: ${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(result.stdout || result.stderr).error, code, name);
    assert.equal(readFileSync(join(root, source), 'utf8'), before);
    assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
  }));
});

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#apply
test('CLI move maps drift after planning to FileChangedSinceRead and exit 1', async () => moveFixture(async root => {
  const publish = LocalRepository.prototype.publishDocumentMove;
  LocalRepository.prototype.publishDocumentMove = async function(plan, dryRun) {
    write(root, 'src/one.ts', '// Concurrent edit\n');
    return publish.call(this, plan, dryRun);
  };
  try {
    const result = await call(root, source, target);
    assert.equal(result.exitCode, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout || result.stderr).error, 'FileChangedSinceRead');
    assert.equal(existsSync(join(root, source)), true);
    assert.equal(existsSync(join(root, target)), false);
    assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
  } finally { LocalRepository.prototype.publishDocumentMove = publish; }
}));
