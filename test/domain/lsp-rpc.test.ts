import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { analysisBudgets, decode, LanguageServersSchema } from '../../src/model/index.ts';
import { LspConnection } from '../../src/base/process/index.ts';
import { server } from '../support/lsp-analysis-source-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C6, C15, C18.
test('bounded JSON-RPC framing rejects malformed messages and cancels timed out requests', () => Effect.runPromise(Effect.gen(function* () {
  const rpc = new LspConnection({ ...analysisBudgets(), requestMs: 20 });
  const sent: string[] = []; rpc.connect(bytes => sent.push(bytes));
  const result = yield* Effect.result(rpc.request('initialize', {}));
  assert.equal(result._tag, 'Failure'); assert.ok(sent.some(bytes => bytes.includes('$/cancelRequest')));
  const invalid = new LspConnection(analysisBudgets()); invalid.connect(() => {});
  invalid.receive(Buffer.from('Content-Length: 1\r\nContent-Length: 1\r\n\r\nx'));
  assert.throws(() => invalid.assertHealthy());
  assert.throws(() => decode(LanguageServersSchema, [server(), server()], 'server config'));
  assert.throws(() => decode(LanguageServersSchema, [{ ...server(), id: 'typescript' }], 'server config'));
  assert.throws(() => decode(LanguageServersSchema, [{ ...server(), extensions: ['.ts'] }], 'server config'));
  assert.throws(() => decode(LanguageServersSchema, [{ ...server(), budgets: { depth: 33 } }], 'server config'));
})));
