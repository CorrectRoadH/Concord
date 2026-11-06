import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { parseDocumentRecord } from '../../src/domain/documents/index.ts';
import { renderDocument } from '../../src/model/index.ts';
import { LocalRepository } from '../support/repository.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { runCli } from '../support/cli.ts';
import { makeRuntimeEnvironment as makeParserRuntime } from '../../src/base/environment/index.ts';
const parserRuntime = makeParserRuntime(process.cwd(), process.env);


const Result = Schema.Struct({ operation: Schema.optional(Schema.String), error: Schema.optional(Schema.String), documents: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String, body: Schema.optional(Schema.String), provider: Schema.optional(Schema.String) }))) });
async function call(root: string, args: readonly string[], status = 0, input = '') {
  const run = await runCli({ argv: ['--root', root, '--json', ...args], cwd: process.cwd(), env: process.env, stdin: input, signal: AbortSignal.timeout(20_000) });
  assert.equal(run.exitCode, status, JSON.stringify({ args, stdout: run.stdout, stderr: run.stderr }));
  return Schema.decodeUnknownSync(Schema.fromJsonString(Result), { onExcessProperty: 'ignore' })(status === 0 || run.stdout.trim() ? run.stdout : run.stderr);
}
function consumer(_name: string): string { return createConsumer(); }
function digestFor(root: string, path: string): string {
  const record = parseDocumentRecord(path, readFileSync(join(root, path), 'utf8'), parserRuntime);
  assert.ok(record);
  return record.digest;
}

function saveBody(root: string, path: string, body: string, expectedDigest: string, status = 0) {
  const record = parseDocumentRecord(path, readFileSync(join(root, path), 'utf8'), parserRuntime)!;
  return call(root, ['action', '--input', '-'], status, JSON.stringify({ action: 'document.set', path, body: renderDocument(record.metadata, body), expectedDigest }));
}

function run(root: string, args: readonly string[], input = '') {
  return runCli({ argv: ['--root', root, ...args], cwd: process.cwd(), env: process.env, stdin: input, signal: AbortSignal.timeout(20_000) });
}

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('packed CLI parse errors preserve the input diagnostic and help remains successful', () => Effect.runPromise(Effect.promise(async () => {
  const root = consumer('parse-errors');
  const ErrorResult = Schema.Struct({ ok: Schema.Boolean, error: Schema.String, message: Schema.String });
  for (const args of [['--json', 'new', 'memory', 'x', '--title', 't', '--type', 'bogus'], ['--json', 'memory', 'search'], ['--json', '--unknown-flag']]) {
    const result = await run(root, args);
    assert.equal(result.exitCode, 1, JSON.stringify(result));
    const error = Schema.decodeUnknownSync(Schema.fromJsonString(ErrorResult))(result.stderr);
    assert.equal(error.error, 'InvalidInput');
    assert.doesNotMatch(error.message, /Help requested/u);
  }
  const help = await run(root, ['new', 'memory', '--help']);
  assert.equal(help.exitCode, 0, help.stderr);
  assert.match(help.stdout, /USAGE/u);
  assert.doesNotMatch(help.stderr, /InvalidInput|OperationFailed/u);
})));
