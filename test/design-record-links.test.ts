import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after, before } from 'node:test';
import { Effect, Schema } from 'effect';
import { renderDocument } from "../src/model/index.js";
import { installConcord, packConcord } from './installed-package.js';

const Finding = Schema.Struct({ category: Schema.String, code: Schema.String, path: Schema.String, line: Schema.optional(Schema.Number), message: Schema.String });
const State = Schema.Struct({ ok: Schema.Boolean, complete: Schema.Boolean });
const Check = Schema.Struct({ ok: Schema.Boolean, complete: Schema.Boolean, findings: Schema.Array(Finding), checks: Schema.Struct({ relations: State, writing: State }) });
const decodeCheck = Schema.decodeUnknownSync(Schema.fromJsonString(Check), { onExcessProperty: 'ignore' });
const scratch = mkdtempSync(join(tmpdir(), 'concord-record-links-'));
let cli: string;
before(() => Effect.runPromise(Effect.sync(() => {
  const tool = join(scratch, 'tool');
  mkdirSync(tool);
  writeFileSync(join(tool, 'package.json'), '{"private":true}\n');
  installConcord(tool, packConcord(scratch));
  cli = join(tool, 'node_modules/concord-sdlc/dist/entry.js');
})));
after(() => Effect.runPromise(Effect.sync(() => rmSync(scratch, { recursive: true, force: true }))));

function call(root: string, args: readonly string[], expected = 0, input?: string): string {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 30_000, input });
  assert.equal(result.status, expected, `${JSON.stringify(args)}\n${result.stdout}\n${result.stderr}`);
  assert(result.stdout.trim().startsWith('{'), result.stderr);
  return result.stdout;
}
function consumer(name: string): string {
  const root = join(scratch, name);
  mkdirSync(root);
  execFileSync('git', ['init', '-q', root]);
  call(root, ['init', '--docs-only']);
  return root;
}
function write(root: string, path: string, source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}
const records = (output: typeof Check.Type) => output.findings.filter(finding => finding.code === 'SpecDependsOnDesignRecord');

// @feature docs/feature/documentation-quality/README.md
test('packed check reports Spec links to Design records with decoded normalized targets and original occurrence lines', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('spec');
  call(root, ['new', 'feature', 'cart', '--title', 'Cart']);
  const path = 'docs/feature/cart/README.md';
  const before = readFileSync(join(root, path), 'utf8');
  const lines = [
    '[candidate](../../design/store/plans/files/README.md)',
    '[encoded](../../%64esign/store/plans/../CASES%2Emd#case)',
    '[encoded slash](../../design%2Fstore/GOALS.md)',
    '[root](../../design/store/README.md#goals)',
    '[decision](../../design/store/DECISION.md#why)',
    '[nested README](../../design/store/support/README.md)',
    '[asset](../../design/store/figure.svg)',
    '[full][Record]',
    '[record][]',
    '[record]',
    '![image](../../design/store/CASES.md)',
    '![record]',
    '`[inline code](../../design/store/CASES.md)`',
    '<!-- [comment](../../design/store/CASES.md) -->',
    '```md', '[fence](../../design/store/CASES.md)', '```',
    '[external](https://example.com/docs/design/store/CASES.md)',
    '[absolute](/docs/design/store/CASES.md)',
    '[navigation](../../design/README.md)',
    '', '[Record]: ../../design/store/LIMITS.md#limit',
  ];
  write(root, path, `${before}\n${lines.join('\n')}\n`);
  const output = decodeCheck(call(root, ['check'], 1));
  assert.equal(output.complete, true);
  assert.deepEqual(output.checks.relations, { ok: false, complete: true });
  const expected = [
    [0, 'plans/files/README.md'], [1, 'CASES.md'], [2, 'GOALS.md'], [5, 'support/README.md'], [6, 'figure.svg'],
    [7, 'LIMITS.md'], [8, 'LIMITS.md'], [9, 'LIMITS.md'],
  ] as const;
  assert.deepEqual(records(output), expected.map(([index, target]) => ({
    category: 'relation', code: 'SpecDependsOnDesignRecord', path,
    line: before.split('\n').length + index + 1,
    message: `Spec links to a Design record page: docs/design/store/${target}`,
  })));
  assert.deepEqual(output.findings, records(output));
})));

// @feature docs/feature/documentation-quality/README.md
test('packed check scopes Spec sources and excludes metadata, comments, code and MDX source while retaining JSX prose', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('scope');
  for (const path of ['docs/design/store/notes.md', 'docs/research/notes.md', 'docs/roadmap/notes.md', 'docs/issues/notes.mdx', 'docs/_template/notes.md', 'memory/notes.md']) {
    write(root, path, path === 'memory/notes.md' ? renderDocument({ format: 'concord.document/v1', kind: 'memory', id: 'notes', title: 'Notes', type: 'note', status: 'captured', relations: [] }, '# Notes\n\n[excluded](../../design/store/CASES.md)\n') : '# Notes\n\n[excluded](../../design/store/CASES.md)\n');
  }
  const path = 'docs/prose.mdx';
  const lines = [
    '---', 'link: "[metadata](design/store/CASES.md)"', '---',
    'import value from "./[import](design/store/CASES.md)"', '',
    'export const data = {', '  link: "[export](design/store/CASES.md)",', '}', '',
    '{/*', '[comment](design/store/CASES.md)', '*/}', '',
    '{(() => {', '  const value = "[expression](design/store/CASES.md)";', '  return value;', '})()}', '',
    '<Panel', '  label="[attribute](design/store/CASES.md)"', '  value={{ text: "[object](design/store/CASES.md)" }}', '>', '',
    '[body](design/store/CASES.md#case)', '', '</Panel>', '',
    '<Panel label="ignored">[inline body](design/store/GOALS.md)</Panel>', '',
    '[reference][record]', '', '[record]: design/store/LIMITS.md', '',
    '```mdx', 'export const text = "[code](design/store/CASES.md)"', '{"[code](design/store/CASES.md)"}', '```', '',
    '`{"[inline](design/store/CASES.md)"}`', '', '<!-- [html comment](design/store/CASES.md) -->',
  ];
  write(root, path, lines.join('\r\n'));
  const output = decodeCheck(call(root, ['check'], 1));
  assert.equal(output.complete, true);
  assert.deepEqual(records(output).map(finding => [finding.path, finding.line]), [
    [path, lines.findIndex(line => line.startsWith('[body]')) + 1],
    [path, lines.findIndex(line => line.startsWith('<Panel label=')) + 1],
    [path, lines.findIndex(line => line.startsWith('[reference]')) + 1],
  ]);
  assert.deepEqual(output.findings, records(output));
  write(root, path, '[allowed](design/store/README.md#goals)\n[allowed](design/store/DECISION.md#why)\n[navigation](design/README.md)\n');
  assert.deepEqual(records(decodeCheck(call(root, ['check']))), []);
  for (const path of ['docs/architecture.md', 'docs/constitution.md', 'docs/top.md', 'docs/feature/cart/notes.mdx', 'docs/engineering/notes.md']) {
    const prefix = path.startsWith('docs/feature/') ? '../../' : path.startsWith('docs/engineering/') ? '../' : '';
    const original = (() => { try { return readFileSync(join(root, path), 'utf8'); } catch { return ''; } })();
    write(root, path, `${original}\n[record](${prefix}design/store/CASES.md)\n`);
  }
  const scoped = decodeCheck(call(root, ['check'], 1));
  assert.equal(records(scoped).length, 5);
})));

// @feature docs/feature/documentation-quality/README.md
test('packed check marks unreadable or unparseable Spec sources and invalid paths incomplete', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer('incomplete');
  const path = 'docs/unreadable.mdx';
  write(root, path, '[record](design/store/CASES.md)\n');
  chmodSync(join(root, path), 0);
  try {
    const output = decodeCheck(call(root, ['check'], 1));
    assert.equal(output.complete, false);
    assert.equal(output.checks.relations.complete, false);
    assert(output.findings.some(finding => finding.path === path));
  } finally { chmodSync(join(root, path), 0o600); }
  write(root, 'docs/unreadable.md', '[record](design/store/CASES.md)\n');
  chmodSync(join(root, 'docs/unreadable.md'), 0);
  try {
    const output = decodeCheck(call(root, ['check'], 1));
    assert.equal(output.complete, false);
    assert.equal(output.checks.relations.complete, false);
    assert(output.findings.some(finding => finding.path === 'docs/unreadable.md' && finding.code === 'SourceReadFailed'));
  } finally { chmodSync(join(root, 'docs/unreadable.md'), 0o600); }
  write(root, 'docs/unreadable.md', '# Readable\n');
  write(root, path, '{"[unclosed](design/store/CASES.md)"\n');
  const malformed = decodeCheck(call(root, ['check'], 1));
  assert.equal(malformed.checks.relations.complete, false);
  assert(malformed.findings.some(finding => finding.code === 'InvalidMarkdownSource' && finding.path === path));
  write(root, path, '[invalid](design/%ZZ/CASES.md)\n[escape](../../outside.md)\n');
  const invalid = decodeCheck(call(root, ['check'], 1));
  assert.equal(invalid.complete, false);
  assert(invalid.findings.some(finding => finding.code === 'DesignRecordLinkInvalid'));
  assert(invalid.findings.some(finding => finding.code === 'UnsafePath'));
})));

// @feature docs/feature/documentation-quality/README.md
test('packed CLI, structured action and Web project check return the same Design record findings', async () => {
  const root = consumer('entrypoints');
  write(root, 'docs/links.md', '[record](design/store/CASES.md)\n');
  const expected = decodeCheck(call(root, ['check'], 1));
  assert.deepEqual(decodeCheck(call(root, ['action', '--input', '-'], 0, '{"action":"check"}')), expected);
  const { startViewServer } = await import("../src/entry/http/view-server.js");
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0, webRoot: join(dirname(cli), 'web') });
  try {
    const body = await new Promise<string>((resolve, reject) => {
      const call = request({ hostname: '127.0.0.1', port: server.port, path: '/api/action', method: 'POST', agent: false, headers: { 'content-type': 'application/json' } }, response => {
        assert.equal(response.statusCode, 200);
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      call.once('error', reject);
      call.end('{"action":"check"}');
    });
    const response = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ ok: Schema.Boolean, value: Check })), { onExcessProperty: 'ignore' })(body);
    assert.equal(response.ok, true);
    assert.deepEqual(response.value, expected);
  } finally { await server.close(); }
});
