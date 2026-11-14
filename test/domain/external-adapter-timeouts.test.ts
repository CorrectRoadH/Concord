import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTypeScriptConfig } from '../../src/base/workspace/index.ts';

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md
test('external adapter timeouts accept longer collection and retain builtin ceilings', async () => {
  const adapter = { id: 'external', include: ['test'], argv: ['runner'], implementationFiles: ['runner'], inputRoots: [], frameworkVersion: '1', lockFiles: [], envNames: [] };
  const config = (value: object) => `export default ${JSON.stringify({ testRoots: ['test'], testAdapters: [value] })};`;
  assert.equal((await parseTypeScriptConfig(config({ ...adapter, collectTimeoutMs: 600000, wallTimeoutMs: 7200000 }))).testAdapters![0]!.collectTimeoutMs, 600000);
  for (const value of [{ collectTimeoutMs: 600001 }, { wallTimeoutMs: 7200001 }]) (await assert.rejects(async () => (await parseTypeScriptConfig(config({ ...adapter, ...value })))));
  const { argv: _argv, ...builtin } = adapter;
  for (const value of [{ collectTimeoutMs: 60001 }, { wallTimeoutMs: 600001 }]) (await assert.rejects(async () => (await parseTypeScriptConfig(config({ ...builtin, builtin: 'node-test', ...value })))));
});
