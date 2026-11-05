import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalRepository } from '../support/repository.js';
import { checkProject } from '../../src/app/project-check.js';
import { documentShow, traceGaps } from '../../src/app/trace-queries.js';

function fixture(run: (repo: LocalRepository, write: (path: string, source?: string) => void) => void) {
  const root = mkdtempSync(join(tmpdir(), 'concord-page-kinds-'));
  let repo: LocalRepository | undefined;
  const write = (path: string, source = '# Page\n') => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); };
  try {
    execFileSync('git', ['init', '-q', root]);
    write('docs/feature/cart/README.md', '# Cart\n');
    write('concord.config.ts', 'export default { sourceRoots: ["src"], testRoots: ["test"] };\n');
    repo = new LocalRepository(root);
    run(repo, write);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
}

// @feature docs/feature/documentation-quality/cli.md#页面种类
test('unknown package pages fail relations with suggestions while readable input remains complete', () => fixture((repo, write) => {
  write('docs/feature/cart/archtecture.md');
  write('docs/feature/cart/scope.md');
  write('docs/feature/cart/library/orphan.md');
  write('docs/feature/cart/format.md');
  mkdirSync(join(repo.root, 'docs/feature/cart/format'));
  for (const kind of ['engineering', 'roadmap']) {
    write(`docs/${kind}/sample/README.md`);
    write(`docs/${kind}/sample/notes.md`);
  }
  write('docs/feature/README.md');
  write('docs/guides/arbitrary.md');
  write('docs/_template/arbitrary.md');
  const report = checkProject(repo, 'off');
  assert.equal(report.ok, false);
  assert.equal(report.complete, true);
  assert.deepEqual(report.checks.relations, { ok: false, complete: true });
  const unknown = report.findings.filter(finding => finding.code === 'UnknownPageKind');
  assert.equal(unknown.length, 6);
  assert.ok(unknown.every(finding => finding.category === 'relation'));
  const typo = unknown.find(finding => finding.path.endsWith('archtecture.md'));
  assert.deepEqual(typo && 'details' in typo ? typo.details : undefined, { suggestions: ['architecture'] });
  const scope = unknown.find(finding => finding.path.endsWith('scope.md'));
  const all = scope && 'details' in scope ? scope.details : undefined;
  assert.ok(all && typeof all === 'object' && 'suggestions' in all && Array.isArray(all.suggestions) && all.suggestions.includes('data-model'));
  const shown = documentShow(repo, 'cart', 'feature', 'off');
  assert.equal(shown.complete, true);
  assert.equal(shown.pages?.find(page => page.path.endsWith('scope.md'))?.kind, 'unknown');
  assert.equal(repo.read('docs/feature/cart/scope.md'), '# Page\n');
}));

// @feature docs/feature/local-sdlc/cli.md#查看一个文档包
test('page kinds inherit directories and prioritize use cases and scoped project rules', () => fixture((repo, write) => {
  const root = 'docs/feature/cart/';
  const expected = [
    ['README.md', 'readme'], ['use-case/README.md', 'use-case-index'], ['use-case/buy.md', 'use-case'],
    ['use-case/concepts.md', 'use-case'], ['architecture/README.md', 'architecture'],
    ['architecture/checkout-flow.md', 'architecture'], ['architecture/concepts.md', 'concepts'],
    ['architecture/deep/writing.md', 'writing'], ['api.md', 'api'], ['format.md', 'format'],
    ['ui.md', 'ui'], ['performance.md', 'performance'], ['data-model.md', 'data-model'],
    ['cli.md', 'unknown'], ['cli/README.md', 'cli'], ['cli/options.md', 'cli'],
  ];
  for (const [path] of expected) write(`${root}${path}`);
  const shown = documentShow(repo, 'cart', 'feature', 'off');
  assert.deepEqual(shown.pages?.map(page => [page.path.slice(root.length), page.kind]), expected.sort((a, b) => a[0]! < b[0]! ? -1 : 1));
  const report = checkProject(repo, 'off');
  assert.deepEqual(report.findings.filter(finding => finding.code === 'UnknownPageKind').map(finding => finding.path), [`${root}cli.md`]);
}));

// @use-case docs/feature/local-sdlc/use-case/inspect-relationship-gaps.md#list-gaps
test('CLI gaps count each directory page directly and exclude engineering and other page kinds', () => fixture((repo, write) => {
  write('docs/feature/cart/cli/README.md', '# Commands\n');
  write('docs/feature/cart/cli/options.md', '# Options\n\n## Flags\n');
  write('docs/feature/cart/api.md');
  write('docs/engineering/build/README.md');
  write('docs/engineering/build/cli.md');
  write('src/cli.ts', '// @concord-file\n// @concord-implements docs/feature/cart/cli/options.md#flags\nexport {};\n');
  const result = traceGaps(repo, 'off');
  assert.deepEqual(result.cliPages.map(page => ({ path: page.path, missing: page.missing, relationships: page.relationships })), [
    { path: 'docs/feature/cart/cli/README.md', missing: ['code', 'test'], relationships: { code: 0, test: 0 } },
    { path: 'docs/feature/cart/cli/options.md', missing: ['test'], relationships: { code: 1, test: 0 } },
  ]);
}));
