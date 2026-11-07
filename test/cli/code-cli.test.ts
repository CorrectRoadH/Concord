import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { CodeDeclarationSchema } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { writeProjectConfig } from '../support/support.ts';
import { runCli } from '../support/cli.ts';

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('code commands map help, marker arguments, locations, trace output and named errors', async () => {
  const root = createConsumer();
  writeProjectConfig(root, { sourceRoots: ['src'] });
  const repo = new LocalRepository(root);
  try { createDocument(repo, 'feature', { id: 'orders', title: 'Orders' }); }
  finally { repo.close(); }
  async function call<A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>, status = 0): Promise<A> {
    const result = await runCli({ argv: ['--root', root, '--json', '--fresh', ...args], cwd: process.cwd(), env: process.env });
    assert.equal(result.exitCode, status, JSON.stringify(result));
    return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(result.stdout.trim() || result.stderr.trim());
  }
  for (const [args, omitted] of [[['code', '--help'], /code show|\bshow\b/u], [['code', 'marker', '--help'], /\bid\b/u]] as const) {
    const result = await runCli({ argv: ['--root', root, ...args], cwd: process.cwd(), env: process.env });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.doesNotMatch(result.stdout, omitted);
  }
  const marker = await call(['code', 'marker', '--scope', 'node', '--contract', 'docs/feature/orders/README.md'], Schema.Struct({ operation: Schema.String, scope: Schema.String, snippet: Schema.String }));
  assert.equal(marker.operation, 'code-marker');
  assert.equal(marker.scope, 'node');
  assert.match(marker.snippet, /@concord-implements docs\/feature\/orders\/README.md/u);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/orders.ts'), `${marker.snippet}export function orders() {}\n`);
  const codes = Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema) });
  const listed = await call(['code', 'list'], codes);
  assert.deepEqual(listed.codes.map(item => item.symbol), ['orders']);
  const located = await call(['code', 'at', `src/orders.ts:${listed.codes[0]!.line}`], codes);
  assert.deepEqual(located.codes.map(item => item.id), listed.codes.map(item => item.id));
  const trace = await call(['trace', 'show', 'orders'], Schema.Struct({ codeDeclarations: Schema.Array(CodeDeclarationSchema) }));
  assert.deepEqual(trace.codeDeclarations.map(item => item.id), listed.codes.map(item => item.id));
  assert.match(await call(['review', 'orders'], Schema.String), /Code declarations/);
  const error = Schema.Struct({ error: Schema.String });
  assert.equal((await call(['code', 'at', 'src/orders.ts:0'], error, 1)).error, 'InvalidCodeLine');
  assert.equal((await call(['code', 'marker', '--scope', 'file'], error, 1)).error, 'MissingCodeContract');
});
