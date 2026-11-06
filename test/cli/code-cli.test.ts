import { createDocument } from '../support/operations.js';
import { createConsumer } from '../support/consumer.js';
import { LocalRepository } from '../support/repository.js';
import type { DocumentKind } from '../../src/model/index.js';
import type { CreateDocumentInput } from '../../src/app/index.js';
import { packageBin } from '../support/installed-package.js';
import { sourceConcord, prepareSourceConsumer } from '../support/installed-package.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { CodeDeclarationSchema } from "../../src/model/index.js";
import { ProjectSchema } from "../../src/model/index.js";
import { readProjectConfig, writeProjectConfig } from '../support/support.js';
import { caseDiscriminator, deriveTestReference } from "../../src/model/index.js";

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('packed CLI traces code scopes and keeps command execution independent of code findings', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-code-cli-'));
  try {
    const packed = sourceConcord();
    assert.ok(packed);
    const install = join(scratch, 'tool'); mkdirSync(install);
    writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
    prepareSourceConsumer(install, packed);
    const cli = packageBin(join(install, 'node_modules/concord-sdlc'));
    const root = join(scratch, 'consumer'); mkdirSync(root);
    execFileSync('git', ['init', '-q', root]);
    function call<A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>, status = 0): A {
      const result = spawnSync(process.execPath, [cli, '--root', root, '--json', '--fresh', ...args], { encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, status, JSON.stringify({ args, status: result.status, signal: result.signal, error: result.error, stdout: result.stdout, stderr: result.stderr }));
      return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(result.stdout.trim() || result.stderr.trim());
    }
    const codeHelp = spawnSync(process.execPath, [cli, '--root', root, 'code', '--help'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(codeHelp.status, 0, codeHelp.stderr);
    assert.doesNotMatch(codeHelp.stdout, /code show|\bshow\b/u);
    const annotateHelp = spawnSync(process.execPath, [cli, '--root', root, 'code', 'marker', '--help'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(annotateHelp.status, 0, annotateHelp.stderr);
    assert.doesNotMatch(annotateHelp.stdout, /\bid\b/u);
    const ack = Schema.Struct({});
    const error = Schema.Struct({ error: Schema.String });
    const codes = Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema) });
    const feature = 'docs/feature/orders/README.md';
    const useCase = 'docs/feature/orders/use-case/create-order.md';
    call(['init', '--docs-only', '--source-root', 'src', '--source-root', 'test'], ack);
    const config = readProjectConfig(root);
    assert.deepEqual(config.sourceRoots, ['src', 'test']);
    assert.deepEqual(config.testRoots, []);
    assert.deepEqual(call(['doctor'], Schema.Struct({ missingSourceRoots: Schema.Array(Schema.String) })).missingSourceRoots, ['src', 'test']);
    const owner = (kind: DocumentKind, input: CreateDocumentInput) => {
      const repo = new LocalRepository(root);
      try { createDocument(repo, kind, input); } finally { repo.close(); }
    };
    owner('feature', { id: 'orders', title: 'Orders' });
    owner('use-case', { id: 'create-order', feature, title: 'Create order' });
    owner('engineering', { id: 'tooling', title: 'Tooling' });
    writeFileSync(join(root, 'docs/feature/orders/architecture.md'), '# Architecture\n\n## Normalize\n\n## Validate\n');
    const engineering = 'docs/engineering/tooling/README.md';
    const engineeringPage = 'docs/engineering/tooling/architecture.md';
    writeFileSync(join(root, engineeringPage), '# Architecture\n\n## Overview\n');
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
    const engineeringOwnerSnippet = call(['code', 'marker', '--scope', 'node', '--contract', engineering], Schema.Struct({ snippet: Schema.String })).snippet;
    const engineeringPageSnippet = call(['code', 'marker', '--scope', 'node', '--contract', `${engineeringPage}#overview`], Schema.Struct({ snippet: Schema.String })).snippet;
    assert.ok(engineeringOwnerSnippet.includes(`// @concord-implements ${engineering}`));
    assert.ok(engineeringPageSnippet.includes(`// @concord-implements ${engineeringPage}#overview`));
    assert.equal(call(['code', 'marker', '--scope', 'node', '--contract', `${engineeringPage}#missing`], error, 1).error, 'AnchorNotFound');
    owner('roadmap', { id: 'roadmap-target', title: 'Roadmap target' });
    assert.equal(call(['code', 'marker', '--scope', 'node', '--contract', 'docs/research/research-target/README.md'], error, 1).error, 'ReferenceNotFound');
    assert.equal(call(['code', 'marker', '--scope', 'node', '--contract', 'docs/roadmap/roadmap-target/README.md'], error, 1).error, 'InvalidReferenceTarget');
    const snippet = call(['code', 'marker', '--scope', 'node', '--contract', useCase, '--contract', `${feature}#orders`], Schema.Struct({ snippet: Schema.String })).snippet;
    assert.ok(snippet.includes(`// @concord-implements ${useCase}`));
    assert.ok(!snippet.includes('code-') && !snippet.includes('声明 ID'));
    assert.deepEqual(call(['code', 'list'], codes).codes, [], 'annotate does not edit source');
    assert.equal(call(['code', 'marker', '--scope', 'file'], error, 1).error, 'MissingCodeContract');
    assert.equal(call(['code', 'marker', '--scope', 'node', '--contract', useCase, '--contract', useCase], error, 1).error, 'DuplicateCodeContract');
    assert.equal(call(['code', 'marker', '--scope', 'node', '--contract', 'docs/feature/absent/README.md'], error, 1).error, 'ReferenceNotFound');
    const source = [
      '// @concord-file', `// @concord-implements ${feature}`, '',
      snippet.trimEnd(), 'export function normalize(input: string) {',
      '  // @concord-begin', `  // @concord-implements ${useCase}`,
      '  const trimmed = input.trim();', '  const result = trimmed.toLowerCase();',
      '  // @concord-end', '  return result;', '}', '',
      '// @concord-code',
      '// @concord-implements docs/feature/orders/architecture.md#normalize',
      '// @concord-implements docs/feature/orders/architecture.md#validate',
      `// @concord-implements ${engineeringPage}#overview`,
      'export const validate = (input: string) => input.length > 0;', '',
    ].join('\n');
    writeFileSync(join(root, 'src/orders.ts'), source);
    const first = call(['code', 'list'], codes).codes;
    assert.equal(first.length, 4);
    assert.deepEqual(new Set(first.map(item => item.scope)), new Set(['file', 'node', 'region']));
    const region = first.find(item => item.scope === 'region'); assert.ok(region);
    const normalize = first.find(item => item.symbol === 'normalize'); assert.ok(normalize);
    const anchor = first.find(item => item.symbol === 'validate'); assert.ok(anchor);
    assert.equal(region.line, source.split('\n').findIndex(line => line.includes('const trimmed')) + 1);
    assert.equal(region.endLine, region.line + 1);
    const located = call(['code', 'at', `src/orders.ts:${region.line}`], codes).codes;
    assert.deepEqual(new Set(located.map(item => item.id)), new Set([first.find(item => item.scope === 'file')?.id, normalize.id, region.id]));
    assert.equal(call(['code', 'at', 'src/orders.ts:0'], error, 1).error, 'InvalidCodeLine');
    assert.equal(call(['code', 'at', 'src/orders.ts:999'], error, 1).error, 'InvalidCodeLine');
    assert.equal(call(['code', 'at', 'README.md:1'], error, 1).error, 'CodeSourceNotScanned');
    const traced = call(['trace', 'show', 'orders'], Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String, symbol: Schema.optional(Schema.String), matchedContracts: Schema.Array(Schema.String) })), tests: Schema.Array(Schema.Unknown) }));
    assert.equal(traced.codeDeclarations.length, 4); assert.deepEqual(traced.tests, []);
    assert.equal(traced.codeDeclarations.find(item => item.symbol === 'validate')?.matchedContracts.length, 2);
    assert.match(call(['review', 'orders'], Schema.String), /Code declarations/);
    const engineeringTrace = call(['trace', 'show', 'tooling'], Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String, contracts: Schema.Array(Schema.String), matchedContracts: Schema.Array(Schema.String) })) }));
    assert.deepEqual(engineeringTrace.codeDeclarations.map(item => item.id), [anchor.id]);
    assert.deepEqual(engineeringTrace.codeDeclarations[0]?.matchedContracts, [`${engineeringPage}#overview`]);
    assert.deepEqual(engineeringTrace.codeDeclarations[0]?.contracts, [
      'docs/feature/orders/architecture.md#normalize',
      'docs/feature/orders/architecture.md#validate',
      `${engineeringPage}#overview`,
    ]);
    const engineeringShow = call(['show', engineering], Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String })) }));
    assert.deepEqual(engineeringShow.codeDeclarations.map(item => item.id), [anchor.id]);
    assert.match(call(['review', 'tooling'], Schema.String), /validate/);
    const check = call(['check'], Schema.Struct({ ok: Schema.Boolean, codeDeclarations: Schema.Int, cases: Schema.Int }));
    assert.deepEqual(check, { ok: true, codeDeclarations: 4, cases: 0 });
    writeFileSync(join(root, 'src/boundaries.ts'), `function last() {\n// @concord-begin\n// @concord-implements ${useCase}\nconst value = 1;\n// @concord-end\n}\n// @concord-begin\n// @concord-implements ${useCase}\nfunction whole() {}\n// @concord-end\n`);
    const terminalRegions = call(['code', 'list'], codes).codes.filter(item => item.file === 'src/boundaries.ts');
    assert.equal(terminalRegions.length, 2);
    rmSync(join(root, 'src/boundaries.ts'));
    call(['cache', 'rebuild'], ack);
    renameSync(join(root, 'src/orders.ts'), join(root, 'src/renamed.ts'));
    writeFileSync(join(root, 'src/renamed.ts'), '\n' + source);
    const moved = call(['code', 'list'], codes).codes.find(item => item.symbol === 'normalize'); assert.ok(moved);
    assert.equal(moved.file, 'src/renamed.ts');
    assert.equal(moved.line, normalize.line + 1);
    call(['cache', 'clear'], ack);
    rmSync(join(root, 'src/renamed.ts'));
    assert.deepEqual(call(['code', 'list'], codes).codes, []);

  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
