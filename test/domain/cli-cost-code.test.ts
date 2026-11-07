import { existsSync } from 'node:fs';
import { createDocument } from '../support/operations.ts';

import { LocalRepository } from '../support/repository.ts';
import type { DocumentKind } from '../../src/model/index.ts';
import type { CreateDocumentInput } from '../../src/app/index.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { executeQuery, executeViewAction, type QueryRequest } from '../../src/app/index.ts';
import { runApplication } from '../support/repository.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { CodeDeclarationSchema } from "../../src/model/index.ts";

import { readProjectConfig } from '../support/support.ts';


// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('code operations preserve scope, reference, trace and cache invalidation guarantees', () => Effect.runPromise(Effect.promise(async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-code-cli-'));
  try {

    assert.ok(existsSync(sourceCli()));
    const root = join(scratch, 'consumer'); mkdirSync(root);
    execFileSync('git', ['init', '-q', root]);
    async function query<A>(request: QueryRequest, schema: Schema.ConstraintDecoder<A, never>, status = 0): Promise<A> {
      const result = await runApplication(executeQuery(root, request));
      assert.equal(result.exitCode, status);
      return Schema.decodeUnknownSync(schema)(result.value);
    }
    async function action<A>(input: unknown, schema: Schema.ConstraintDecoder<A, never>, status = 0): Promise<A> {
      const result = await runApplication(executeViewAction(root, input)).then(value => ({ status: 0, value }), error => ({ status: 1, value: { error: error.code } }));
      assert.equal(result.status, status, JSON.stringify(result.value));
      return Schema.decodeUnknownSync(schema)(result.value);
    }
    const ack = Schema.Struct({});
    const error = Schema.Struct({ error: Schema.String });
    const codes = Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema) });
    const feature = 'docs/feature/orders/README.md';
    const useCase = 'docs/feature/orders/use-case/create-order.md';
    (await action({ action: 'init', docsOnly: true, sourceRoots: ['src', 'test'] }, ack));
    const config = (await readProjectConfig(root));
    assert.deepEqual(config.sourceRoots, ['src', 'test']);
    assert.deepEqual(config.testRoots, []);
    assert.deepEqual((await action({ action: 'doctor' }, Schema.Struct({ missingSourceRoots: Schema.Array(Schema.String) }))).missingSourceRoots, ['src', 'test']);
    const owner = async (kind: DocumentKind, input: CreateDocumentInput) => {
      const repo = (await LocalRepository.open(root));
      try { (await createDocument(repo, kind, input)); } finally { repo.close(); }
    };
    (await owner('feature', { id: 'orders', title: 'Orders' }));
    (await owner('use-case', { id: 'create-order', feature, title: 'Create order' }));
    (await owner('engineering', { id: 'tooling', title: 'Tooling' }));
    writeFileSync(join(root, 'docs/feature/orders/architecture.md'), '# Architecture\n\n## Normalize\n\n## Validate\n');
    const engineering = 'docs/engineering/tooling/README.md';
    const engineeringPage = 'docs/engineering/tooling/architecture.md';
    writeFileSync(join(root, engineeringPage), '# Architecture\n\n## Overview\n');
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
    const engineeringOwnerSnippet = (await action({ action: 'code.marker', scope: 'node', contracts: [engineering] }, Schema.Struct({ snippet: Schema.String }))).snippet;
    const engineeringPageSnippet = (await action({ action: 'code.marker', scope: 'node', contracts: [`${engineeringPage}#overview`] }, Schema.Struct({ snippet: Schema.String }))).snippet;
    assert.ok(engineeringOwnerSnippet.includes(`// @concord-implements ${engineering}`));
    assert.ok(engineeringPageSnippet.includes(`// @concord-implements ${engineeringPage}#overview`));
    assert.equal((await action({ action: 'code.marker', scope: 'node', contracts: [`${engineeringPage}#missing`] }, error, 1)).error, 'AnchorNotFound');
    (await owner('roadmap', { id: 'roadmap-target', title: 'Roadmap target' }));
    assert.equal((await action({ action: 'code.marker', scope: 'node', contracts: ['docs/research/research-target/README.md'] }, error, 1)).error, 'ReferenceNotFound');
    assert.equal((await action({ action: 'code.marker', scope: 'node', contracts: ['docs/roadmap/roadmap-target/README.md'] }, error, 1)).error, 'InvalidReferenceTarget');
    const snippet = (await action({ action: 'code.marker', scope: 'node', contracts: [useCase, `${feature}#orders`] }, Schema.Struct({ snippet: Schema.String }))).snippet;
    assert.ok(snippet.includes(`// @concord-implements ${useCase}`));
    assert.ok(!snippet.includes('code-') && !snippet.includes('声明 ID'));
    assert.deepEqual((await query({ name: 'code.list', input: {} }, codes)).codes, [], 'annotate does not edit source');
    assert.equal((await action({ action: 'code.marker', scope: 'file', contracts: [] }, error, 1)).error, 'MissingCodeContract');
    assert.equal((await action({ action: 'code.marker', scope: 'node', contracts: [useCase, useCase] }, error, 1)).error, 'DuplicateCodeContract');
    assert.equal((await action({ action: 'code.marker', scope: 'node', contracts: ['docs/feature/absent/README.md'] }, error, 1)).error, 'ReferenceNotFound');
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
    const first = (await query({ name: 'code.list', input: {} }, codes)).codes;
    assert.equal(first.length, 4);
    assert.deepEqual(new Set(first.map(item => item.scope)), new Set(['file', 'node', 'region']));
    const region = first.find(item => item.scope === 'region'); assert.ok(region);
    const normalize = first.find(item => item.symbol === 'normalize'); assert.ok(normalize);
    const anchor = first.find(item => item.symbol === 'validate'); assert.ok(anchor);
    assert.equal(region.line, source.split('\n').findIndex(line => line.includes('const trimmed')) + 1);
    assert.equal(region.endLine, region.line + 1);
    const located = (await action({ action: 'code.at', path: 'src/orders.ts', line: region.line }, codes)).codes;
    assert.deepEqual(new Set(located.map(item => item.id)), new Set([first.find(item => item.scope === 'file')?.id, normalize.id, region.id]));
    assert.equal((await action({ action: 'code.at', path: 'src/orders.ts', line: 0 }, error, 1)).error, 'InvalidCodeLine');
    assert.equal((await action({ action: 'code.at', path: 'src/orders.ts', line: 999 }, error, 1)).error, 'InvalidCodeLine');
    assert.equal((await action({ action: 'code.at', path: 'README.md', line: 1 }, error, 1)).error, 'CodeSourceNotScanned');
    const traced = (await query({ name: 'trace.show', input: { reference: 'orders' } }, Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String, symbol: Schema.optional(Schema.String), matchedContracts: Schema.Array(Schema.String) })), tests: Schema.Array(Schema.Unknown) })));
    assert.equal(traced.codeDeclarations.length, 4); assert.deepEqual(traced.tests, []);
    assert.equal(traced.codeDeclarations.find(item => item.symbol === 'validate')?.matchedContracts.length, 2);
    assert.match((await query({ name: 'review', input: { reference: 'orders' } }, Schema.String)), /Code declarations/);
    const engineeringTrace = (await query({ name: 'trace.show', input: { reference: 'tooling' } }, Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String, contracts: Schema.Array(Schema.String), matchedContracts: Schema.Array(Schema.String) })) })));
    assert.deepEqual(engineeringTrace.codeDeclarations.map(item => item.id), [anchor.id]);
    assert.deepEqual(engineeringTrace.codeDeclarations[0]?.matchedContracts, [`${engineeringPage}#overview`]);
    assert.deepEqual(engineeringTrace.codeDeclarations[0]?.contracts, [
      'docs/feature/orders/architecture.md#normalize',
      'docs/feature/orders/architecture.md#validate',
      `${engineeringPage}#overview`,
    ]);
    const engineeringShow = (await query({ name: 'documents.show', input: { id: engineering } }, Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String })) })));
    assert.deepEqual(engineeringShow.codeDeclarations.map(item => item.id), [anchor.id]);
    assert.match((await query({ name: 'review', input: { reference: 'tooling' } }, Schema.String)), /validate/);
    const check = (await query({ name: 'check', input: {} }, Schema.Struct({ ok: Schema.Boolean, codeDeclarations: Schema.Int, cases: Schema.Int })));
    assert.deepEqual(check, { ok: true, codeDeclarations: 4, cases: 0 });
    writeFileSync(join(root, 'src/boundaries.ts'), `function last() {\n// @concord-begin\n// @concord-implements ${useCase}\nconst value = 1;\n// @concord-end\n}\n// @concord-begin\n// @concord-implements ${useCase}\nfunction whole() {}\n// @concord-end\n`);
    const terminalRegions = (await query({ name: 'code.list', input: {} }, codes)).codes.filter(item => item.file === 'src/boundaries.ts');
    assert.equal(terminalRegions.length, 2);
    rmSync(join(root, 'src/boundaries.ts'));
    (await action({ action: 'cache.rebuild' }, ack));
    renameSync(join(root, 'src/orders.ts'), join(root, 'src/renamed.ts'));
    writeFileSync(join(root, 'src/renamed.ts'), '\n' + source);
    const moved = (await query({ name: 'code.list', input: {} }, codes)).codes.find(item => item.symbol === 'normalize'); assert.ok(moved);
    assert.equal(moved.file, 'src/renamed.ts');
    assert.equal(moved.line, normalize.line + 1);
    (await action({ action: 'cache.clear' }, ack));
    rmSync(join(root, 'src/renamed.ts'));
    assert.deepEqual((await query({ name: 'code.list', input: {} }, codes)).codes, []);

  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
