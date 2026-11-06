import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { positionOffset, documentSymbols, bindSymbol, observation, relevanceFor, historicalAnalysis, type AnnotatedCase, type DocumentRecord } from '../../src/model/index.ts';
import { source, target, server } from '../support/lsp-analysis-source-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C11; test-journey-steps C6, C7.
test('range encoding, profile policy and relevance levels stay explicit', () => Effect.runPromise(Effect.sync(() => {
  assert.equal(positionOffset('a😀z\n', { line: 0, character: 5 }, 'utf-8'), 3);
  assert.equal(positionOffset('a😀z\n', { line: 0, character: 2 }, 'utf-32'), 3);
  assert.equal(positionOffset('a😀z\n', { line: 0, character: 3 }, 'utf-16'), 3);
  assert.throws(() => positionOffset('a😀z', { line: 0, character: 2 }, 'utf-16'));
  const symbol = { name: 'implementation', kind: 12, range: { start: { line: 2, character: 0 }, end: { line: 3, character: 12 } }, selectionRange: { start: { line: 2, character: 4 }, end: { line: 2, character: 18 } } };
  const parsed = documentSymbols([symbol], source, 'utf-16', 100);
  assert.deepEqual(parsed.gaps, []);
  const code = { id: 'code-sample', file: 'src/sample.py', line: 1, endLine: 1, scope: 'node' as const, contracts: [target] };
  assert.equal(bindSymbol(code, source, parsed.symbols, server(), 'utf-16')?.name, 'implementation');
  assert.equal(bindSymbol(code, source, [symbol, symbol], server(), 'utf-16'), undefined);
  assert.deepEqual(documentSymbols([{ ...symbol, children: [{ ...symbol, range: { start: { line: 0, character: 0 }, end: { line: 3, character: 12 } } }] }], source, 'utf-16', 100).gaps, ['UnsupportedSymbolBinding']);
  const test = { id: 'test-sample', contract: `${target}#step-one` } as AnnotatedCase;
  const docs = [{ path: target, metadata: { kind: 'use-case', feature: 'docs/feature/sample/README.md' } }] as DocumentRecord[];
  const stepCode = { ...code, contracts: [test.contract] };
  const observed = observation({ analyzer: 'fixture', profile: 'fixture-v1', encoding: 'utf-16' as const, locators: [], dependencies: [{ testId: test.id, scope: 'file' as const, file: 'test/sample.py', declarations: [code.id], edges: [], gaps: ['FileScope'] }], gaps: ['OpenWorldCalls'] }, 'sha256:fixture', ['OpenWorldCalls'], true, '2026-10-30T00:00:00.000Z');
  const relevance = relevanceFor(test, [stepCode], [observed], docs, new Set([test.contract]));
  assert.equal(relevance.verdict, 'observed'); if (relevance.verdict === 'observed') assert.equal(relevance.level, 'step');
  assert.equal(relevanceFor(test, [{ ...code, contracts: ['docs/feature/other/README.md'] }], [observed], docs).verdict, 'not-observed');
  const unavailable = { observations: [], relevance: [{ testId: test.id, scope: 'file' as const, relevance: { verdict: 'not-observed' as const, gaps: ['NoAnalyzer', 'FileScope'] as [string, ...string[]] }, message: '未观察到交集' }] };
  assert.deepEqual(historicalAnalysis(unavailable), unavailable);
})));



// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C1, C11.
test('decorated classes do not replace nearer same-named methods during binding', () => Effect.runPromise(Effect.sync(() => {
  const text = `# @concord-code\n# @concord-implements ${target}\n@decorator\nclass Box:\n    # @concord-code\n    # @concord-implements ${target}\n    @decorator\n    def same(self):\n        return 1\n    # @concord-code\n    # @concord-implements ${target}\n    def same(self):\n        return 2\n`;
  const range = (start: number, end: number, startColumn = 4, endColumn = 16) => ({ start: { line: start, character: startColumn }, end: { line: end, character: endColumn } });
  const first = { name: 'same', kind: 6, range: range(7, 8), selectionRange: range(7, 7, 8, 12) };
  const second = { name: 'same', kind: 6, range: range(11, 12), selectionRange: range(11, 11, 8, 12) };
  const outer = { name: 'Box', kind: 5, range: range(3, 12, 0), selectionRange: range(3, 3, 6, 9), children: [first, second] };
  const symbols = documentSymbols([outer], text, 'utf-16', 20); assert.deepEqual(symbols.gaps, []);
  const declaration = { id: 'code-example', file: 'src/sample.py', line: 5, endLine: 5, scope: 'node' as const, contracts: [target] };
  assert.deepEqual(bindSymbol(declaration, text, symbols.symbols, server(), 'utf-16')?.range, first.range);
  assert.deepEqual(bindSymbol({ ...declaration, line: 10 }, text, symbols.symbols, server(), 'utf-16')?.range, second.range);
  assert.equal(bindSymbol(declaration, text, symbols.symbols, { ...server(), profile: { ...server().profile, decorators: 'none' } }, 'utf-16'), undefined);
})));
