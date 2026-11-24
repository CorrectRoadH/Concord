import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { getViewFile, renderPage, checkProject } from '../../src/app/index.ts';
import { ConcordError, digest, renderWritingPolicy } from '../../src/model/index.ts';
import { RenderedPage } from '../../src/model/herdr-mod/index.ts';
import { inspectDocuments } from '../../src/app/editing.ts';
import { documentShow } from '../../src/app/trace-queries.ts';
import { Schema } from 'effect';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { tmpdir } from '../support/temporary.ts';

const owner = 'docs/feature/cart';
const page = `${owner}/statechart.md`;
const expected = 'sha256:36f322b899cf03fe4a1dfd6e199eab4a472ab66082251c46bc7a0979d024756f';
const outdated = 'sha256:' + '0'.repeat(64);
const reportText = '# Current report\n\nText unchanged.\n';
const chartText = `stateDiagram-v2
[*] --> A
A --> B
classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px
class A breaks
class B mayBreak
`;
const attributes = { spec: './tla/Model.tla', config: './tla/config.cfg', view: './tla/view.ts', out: './tla/out', digest: expected };

function block(overrides: Readonly<Record<string, string | undefined>> = {}, contents = ''): string {
  const info = Object.entries({ ...attributes, ...overrides }).flatMap(([name, value]) => value === undefined ? [] : `${name}="${value}"`).join(' ');
  return '~~~statechart ' + info + '\n' + contents + '~~~\n';
}

async function fixture(run: (options: { root: string; repo: LocalRepository; write: (path: string, text: string | Uint8Array) => void }) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'concord-statechart-'));
  const write = (path: string, text: string | Uint8Array) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    write(`${owner}/README.md`, '# Cart\n');
    write(`${owner}/tla/Model.tla`, 'Model\n');
    write(`${owner}/tla/config.cfg`, 'cfg\r\n');
    write(`${owner}/tla/view.ts`, 'export {};\n');
    write(`${owner}/tla/Zeta.tla`, Uint8Array.of(255, 0));
    write(`${owner}/tla/é.tla`, '模块\n');
    write(`${owner}/tla/𐀀.tla`, 'supplement\n');
    write(`${owner}/tla/\uE000.tla`, 'private\n');
    write(`${owner}/tla/out/ignored.tla`, 'Not a model input\n');
    write(`${owner}/tla/nested/ignored.tla`, 'TLC resolves modules in the model directory\n');
    write(`${owner}/tla/out/report.md`, reportText);
    write(page, '# Cart statechart\n\n' + block());
    repo = await LocalRepository.open(root);
    await run({ root, repo, write });
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
}

// @feature docs/feature/local-sdlc/format.md#状态图块
test('statechart digest hashes raw bytes from the direct model inputs in UTF-8 path order', async () => fixture(async ({ repo, write }) => {
  const initial = await checkProject(repo, 'off');
  assert.deepEqual(initial.findings, []);
  write(page, '# Cart statechart\n\n' + block({ digest: outdated }));
  const findings = (await checkProject(repo, 'off')).findings.filter(finding => finding.code === 'StatechartStale');
  assert.deepEqual(findings.map(finding => 'details' in finding && finding.details), [{ expected: outdated, actual: expected }]);
}));

// @feature docs/feature/local-sdlc/format.md#状态图块
test('generated Markdown stays out of discovery, page kinds and writing checks', async () => fixture(async ({ repo, write }) => {
  const output = `${owner}/tla/out`;
  write('docs/writing.md', renderWritingPolicy({ roots: ['docs'], bannedTerms: [{ term: 'artifactnoise', use: 'term', why: 'Scope fixture' }] }));
  write(`${output}/report.md`, '# Report\n\nartifactnoise\n');
  write(`${output}/README.md`, '---\ninvalid: [\n---\n# Generated\n');
  write(`${output}/concepts.md`, '---\ninvalid: [\n---\n');
  const result = await checkProject(repo, 'off');
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
  assert.ok(!inspectDocuments(repo).pages.some(candidate => candidate.path.startsWith(output)));
  assert.deepEqual((await documentShow(repo, 'cart', 'feature', 'off')).pages?.map(candidate => candidate.path), [`${owner}/README.md`, page]);
  write(`${owner}/statechart/README.md`, '# Split statechart\n');
  assert.ok((await checkProject(repo, 'off')).findings.some(finding => finding.code === 'UnknownPageKind' && finding.path === page));
}));

// @feature docs/feature/documentation-quality/cli.md#状态图
test('check reports five statechart findings at opening fences and keeps the relation result complete', async () => fixture(async ({ repo, write }) => {
  write(`${owner}/cli.md`, '# Commands\n\n' + block());
  write(page, '# Cart statechart\n\n'
    + block({ digest: 'bad' }) + '\n'
    + block({ view: './tla/missing.ts', digest: outdated }) + '\n'
    + block({ out: './tla/nested' }) + '\n'
    + block({ digest: outdated }));
  const result = await checkProject(repo, 'off');
  assert.equal(result.ok, false);
  assert.equal(result.complete, true);
  assert.deepEqual(result.checks.relations, { ok: false, complete: true });
  const findings = result.findings.filter(finding => /Statechart/u.test(finding.code));
  assert.ok(findings.every(finding => finding.category === 'relation'));
  assert.deepEqual(findings.map(finding => [finding.code, finding.path, finding.line, 'details' in finding ? finding.details : undefined]), [
    ['InvalidStatechartPosition', `${owner}/cli.md`, 3, undefined],
    ['InvalidStatechartBlock', page, 3, { attribute: 'digest' }],
    ['StatechartFileNotFound', page, 6, { attribute: 'view', target: './tla/missing.ts' }],
    ['StatechartReportNotFound', page, 9, { target: `${owner}/tla/nested/report.md` }],
    ['StatechartStale', page, 12, { expected: outdated, actual: expected }],
  ]);
}));

// @feature docs/feature/herdr-mod/cli.md#渲染一页
test('page.render returns statechart artifacts, blocked outlines, shared freshness and local errors', async () => fixture(async ({ root, repo, write }) => {
  write(`${owner}/tla/out/chart.mmd`, chartText);
  const render = async () => Schema.decodeUnknownSync(RenderedPage, { onExcessProperty: 'error' })(await runApplication(renderPage(root, page, { blocked: '#ff1133' })));
  const first = (await render()).blocks.find(block => block.type === 'statechart');
  assert.ok(first && !('error' in first));
  assert.equal(first.spec, `${owner}/tla/Model.tla`);
  assert.equal(first.config, `${owner}/tla/config.cfg`);
  assert.equal(first.view, `${owner}/tla/view.ts`);
  assert.equal(first.out, `${owner}/tla/out`);
  assert.equal(first.stale, false);
  assert.deepEqual(first.report, { text: reportText });
  assert.ok(first.chart && 'svg' in first.chart);
  assert.match(first.chart.svg, /breaks[\s\S]*#ff1133/u);
  assert.match(first.chart.svg, /mayBreak[\s\S]*stroke-dasharray/u);
  assert.equal(first.chart.digest, digest(first.chart.svg));
  rmSync(join(root, owner, 'tla/out/chart.mmd'));
  write(page, '# Cart statechart\n\n' + block({ digest: outdated }) + '\n' + block({}, 'unexpected\n'));
  const second = (await render()).blocks.filter(block => block.type === 'statechart');
  assert.ok(second[0] && !('error' in second[0]) && second[0].stale && second[0].chart === undefined);
  assert.ok(second[1] && 'error' in second[1] && /body/u.test(second[1].error));
  assert.equal((await checkProject(repo, 'off')).findings.some(finding => finding.code === 'StatechartStale'), second[0].stale);
}));

// @feature docs/feature/local-sdlc/format.md#状态图块
test('getViewFile reads referenced statechart sources and rejects unreferenced, outside and symlinked paths', async () => fixture(async ({ root, write }) => {
  for (const [target, text] of Object.entries({ 'Model.tla': 'Model\n', 'config.cfg': 'cfg\r\n', 'view.ts': 'export {};\n' })) {
    assert.equal((await runApplication(getViewFile(root, `${owner}/tla/${target}`))).body, text);
  }
  symlinkSync(join(root, owner, 'tla/Model.tla'), join(root, 'linked.tla'));
  write(page, '# Cart statechart\n\n' + block() + block({ spec: '../../../linked.tla' }) + block({ spec: '../../../../outside.tla' }));
  for (const target of [`${owner}/tla/Zeta.tla`, '../outside.tla', 'linked.tla']) {
    await assert.rejects(runApplication(getViewFile(root, target)), cause => cause instanceof ConcordError && ['FileNotFound', 'UnsafePath'].includes(cause.code));
  }
}));

// @feature docs/feature/local-sdlc/format.md#状态图块
test('check rejects a symlinked statechart target under docs at the snapshot boundary', async () => fixture(async ({ root, repo, write }) => {
  symlinkSync('Model.tla', join(root, owner, 'tla/link.tla'));
  write(page, '# Cart statechart\n\n' + block({ spec: './tla/link.tla' }));
  await assert.rejects(checkProject(repo, 'off'), { code: 'UnsafePath' });
}));

// @feature docs/feature/documentation-quality/cli.md#状态图
test('check reports a missing statechart file for outside-docs symlinks and restricted paths', async () => fixture(async ({ root, repo, write }) => {
  symlinkSync(join(root, owner, 'tla/Model.tla'), join(root, 'linked.tla'));
  const refs = ['../../../linked.tla', '../../../../outside.tla', './tla/.hidden.tla', './tla/node_modules/model.tla'];
  write(page, '# Cart statechart\n\n' + refs.map(spec => block({ spec })).join('\n'));
  const result = await checkProject(repo, 'off');
  const findings = result.findings.filter(finding => /Statechart/u.test(finding.code));
  assert.deepEqual(findings.map(finding => [finding.code, 'details' in finding && finding.details]),
    refs.map(target => ['StatechartFileNotFound', { attribute: 'spec', target }]));
  assert.equal(result.complete, true);
}));
