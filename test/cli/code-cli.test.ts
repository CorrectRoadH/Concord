import { existsSync } from 'node:fs';
import { createDocument } from '../support/operations.ts';

import { LocalRepository } from '../support/repository.ts';
import type { DocumentKind } from '../../src/model/index.ts';
import type { CreateDocumentInput } from '../../src/app/index.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { runCli } from '../support/cli.ts';
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
test('packed CLI traces code scopes and keeps command execution independent of code findings', () => Effect.runPromise(Effect.promise(async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-code-cli-'));
  try {

    assert.ok(existsSync(sourceCli()));
    const cli = sourceCli();
    const root = join(scratch, 'consumer'); mkdirSync(root);
    execFileSync('git', ['init', '-q', root]);
    async function call<A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>, status = 0): Promise<A> {
      const result = await runCli({argv:['--root',root,'--json','--fresh',...args],cwd:process.cwd(),env:process.env,signal:AbortSignal.timeout(30000)});
      assert.equal(result.exitCode, status, JSON.stringify({ args, status: result.exitCode, stdout: result.stdout, stderr: result.stderr }));
      return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(result.stdout.trim() || result.stderr.trim());
    }
    const codeHelp = await runCli({argv:['--root',root,'code','--help'],cwd:process.cwd(),env:process.env,signal:AbortSignal.timeout(10000)});
    assert.equal(codeHelp.exitCode, 0, codeHelp.stderr);
    assert.doesNotMatch(codeHelp.stdout, /code show|\bshow\b/u);
    const annotateHelp = await runCli({argv:['--root',root,'code','marker','--help'],cwd:process.cwd(),env:process.env,signal:AbortSignal.timeout(10000)});
    assert.equal(annotateHelp.exitCode, 0, annotateHelp.stderr);
    assert.doesNotMatch(annotateHelp.stdout, /\bid\b/u);
    const ack = Schema.Struct({});
    const error = Schema.Struct({ error: Schema.String });
    const codes = Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema) });
    const feature = 'docs/feature/orders/README.md';
    const useCase = 'docs/feature/orders/use-case/create-order.md';
    (await call(['init', '--docs-only', '--source-root', 'src', '--source-root', 'test'], ack));
    const config = readProjectConfig(root);
    assert.deepEqual(config.sourceRoots, ['src', 'test']);
    assert.deepEqual(config.testRoots, []);
    assert.deepEqual((await call(['doctor'], Schema.Struct({ missingSourceRoots: Schema.Array(Schema.String) }))).missingSourceRoots, ['src', 'test']);
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
    const engineeringOwnerSnippet = (await call(['code', 'marker', '--scope', 'node', '--contract', engineering], Schema.Struct({ snippet: Schema.String }))).snippet;
    const engineeringPageSnippet = (await call(['code', 'marker', '--scope', 'node', '--contract', `${engineeringPage}#overview`], Schema.Struct({ snippet: Schema.String }))).snippet;
    assert.ok(engineeringOwnerSnippet.includes(`// @concord-implements ${engineering}`));
    assert.ok(engineeringPageSnippet.includes(`// @concord-implements ${engineeringPage}#overview`));
    assert.equal((await call(['code', 'marker', '--scope', 'node', '--contract', `${engineeringPage}#missing`], error, 1)).error, 'AnchorNotFound');
    owner('roadmap', { id: 'roadmap-target', title: 'Roadmap target' });
    assert.equal((await call(['code', 'marker', '--scope', 'node', '--contract', 'docs/research/research-target/README.md'], error, 1)).error, 'ReferenceNotFound');
    assert.equal((await call(['code', 'marker', '--scope', 'node', '--contract', 'docs/roadmap/roadmap-target/README.md'], error, 1)).error, 'InvalidReferenceTarget');
    const snippet = (await call(['code', 'marker', '--scope', 'node', '--contract', useCase, '--contract', `${feature}#orders`], Schema.Struct({ snippet: Schema.String }))).snippet;
    assert.ok(snippet.includes(`// @concord-implements ${useCase}`));
    assert.ok(!snippet.includes('code-') && !snippet.includes('声明 ID'));
    assert.deepEqual((await call(['code', 'list'], codes)).codes, [], 'annotate does not edit source');
    assert.equal((await call(['code', 'marker', '--scope', 'file'], error, 1)).error, 'MissingCodeContract');
    assert.equal((await call(['code', 'marker', '--scope', 'node', '--contract', useCase, '--contract', useCase], error, 1)).error, 'DuplicateCodeContract');
    assert.equal((await call(['code', 'marker', '--scope', 'node', '--contract', 'docs/feature/absent/README.md'], error, 1)).error, 'ReferenceNotFound');
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
    const first = (await call(['code', 'list'], codes)).codes;
    assert.equal(first.length, 4);
    assert.deepEqual(new Set(first.map(item => item.scope)), new Set(['file', 'node', 'region']));
    const region = first.find(item => item.scope === 'region'); assert.ok(region);
    const normalize = first.find(item => item.symbol === 'normalize'); assert.ok(normalize);
    const anchor = first.find(item => item.symbol === 'validate'); assert.ok(anchor);
    assert.equal(region.line, source.split('\n').findIndex(line => line.includes('const trimmed')) + 1);
    assert.equal(region.endLine, region.line + 1);
    const located = (await call(['code', 'at', `src/orders.ts:${region.line}`], codes)).codes;
    assert.deepEqual(new Set(located.map(item => item.id)), new Set([first.find(item => item.scope === 'file')?.id, normalize.id, region.id]));
    assert.equal((await call(['code', 'at', 'src/orders.ts:0'], error, 1)).error, 'InvalidCodeLine');
    assert.equal((await call(['code', 'at', 'src/orders.ts:999'], error, 1)).error, 'InvalidCodeLine');
    assert.equal((await call(['code', 'at', 'README.md:1'], error, 1)).error, 'CodeSourceNotScanned');
    const traced = (await call(['trace', 'show', 'orders'], Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String, symbol: Schema.optional(Schema.String), matchedContracts: Schema.Array(Schema.String) })), tests: Schema.Array(Schema.Unknown) })));
    assert.equal(traced.codeDeclarations.length, 4); assert.deepEqual(traced.tests, []);
    assert.equal(traced.codeDeclarations.find(item => item.symbol === 'validate')?.matchedContracts.length, 2);
    assert.match((await call(['review', 'orders'], Schema.String)), /Code declarations/);
    const engineeringTrace = (await call(['trace', 'show', 'tooling'], Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String, contracts: Schema.Array(Schema.String), matchedContracts: Schema.Array(Schema.String) })) })));
    assert.deepEqual(engineeringTrace.codeDeclarations.map(item => item.id), [anchor.id]);
    assert.deepEqual(engineeringTrace.codeDeclarations[0]?.matchedContracts, [`${engineeringPage}#overview`]);
    assert.deepEqual(engineeringTrace.codeDeclarations[0]?.contracts, [
      'docs/feature/orders/architecture.md#normalize',
      'docs/feature/orders/architecture.md#validate',
      `${engineeringPage}#overview`,
    ]);
    const engineeringShow = (await call(['show', engineering], Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String })) })));
    assert.deepEqual(engineeringShow.codeDeclarations.map(item => item.id), [anchor.id]);
    assert.match((await call(['review', 'tooling'], Schema.String)), /validate/);
    const check = (await call(['check'], Schema.Struct({ ok: Schema.Boolean, codeDeclarations: Schema.Int, cases: Schema.Int })));
    assert.deepEqual(check, { ok: true, codeDeclarations: 4, cases: 0 });
    writeFileSync(join(root, 'src/boundaries.ts'), `function last() {\n// @concord-begin\n// @concord-implements ${useCase}\nconst value = 1;\n// @concord-end\n}\n// @concord-begin\n// @concord-implements ${useCase}\nfunction whole() {}\n// @concord-end\n`);
    const terminalRegions = (await call(['code', 'list'], codes)).codes.filter(item => item.file === 'src/boundaries.ts');
    assert.equal(terminalRegions.length, 2);
    rmSync(join(root, 'src/boundaries.ts'));
    (await call(['cache', 'rebuild'], ack));
    renameSync(join(root, 'src/orders.ts'), join(root, 'src/renamed.ts'));
    writeFileSync(join(root, 'src/renamed.ts'), '\n' + source);
    const moved = (await call(['code', 'list'], codes)).codes.find(item => item.symbol === 'normalize'); assert.ok(moved);
    assert.equal(moved.file, 'src/renamed.ts');
    assert.equal(moved.line, normalize.line + 1);
    (await call(['cache', 'clear'], ack));
    rmSync(join(root, 'src/renamed.ts'));
    assert.deepEqual((await call(['code', 'list'], codes)).codes, []);

  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
