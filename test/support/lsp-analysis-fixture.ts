import { packageBin } from '../../scripts/package-location.js';
import { createDocument } from "../../src/app/index.js";
import { createConsumer } from './consumer.js';
import { installedConcordCli } from './support.js';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from './temporary.js';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { buildSync } from 'esbuild';
import { analysisBudgets, LanguageServersSchema, type language_server_config_LanguageServer as LanguageServer } from "../../src/model/index.js";
import { documentSymbols, positionOffset, bindSymbol } from "../../src/model/index.js";
import { LspConnection } from "../../src/base/process/index.js";
import { AnalysisObservationSchema } from "../../src/model/index.js";
import { AnalysisViewSchema, historicalAnalysis, relevanceFor } from "../../src/model/index.js";
import { CodeDeclarationSchema } from "../../src/model/index.js";
import { decode, type AnnotatedCase, type DocumentRecord } from "../../src/model/index.js";
import { observation } from "../../src/model/index.js";
import { LocalRepository } from "./repository.js";
import { withPersistentCache } from "../../src/base/cache/index.js";
import { observeOwnedProcessGroup } from "../../src/base/process/index.js";
import { hydrateQueryValue } from "../../src/app/index.js";
import { TraceShowValue } from "../../src/model/index.js";
import { pollUntil, readProjectConfig, writeProjectConfig } from './support.js';
import { packConcord } from './installed-package.js';

export const cli = installedConcordCli();
export const target = 'docs/feature/sample/use-case/sample.md';
export const source = `# @concord-code\n# @concord-implements ${target}\ndef implementation():\n    return 1\n`;
export function write(root: string, path: string, text: string): void { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
export function call<A>(root: string, args: readonly string[], schema: Schema.ConstraintDecoder<A, never>, status = 0, binary = cli, env = process.env): A {
  const result = spawnSync(process.execPath, [binary, '--root', root, '--json', '--fresh', ...args], { env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const text = result.stdout + result.stderr;
  assert.equal(result.error, undefined, String(result.error)); assert.equal(result.status, status, text);
  return Schema.decodeUnknownSync(schema, { onExcessProperty: 'ignore' })(JSON.parse(text));
}
export const ack = Schema.Record(Schema.String, Schema.Unknown);
export const failure = Schema.Struct({ error: Schema.String, message: Schema.String });
export const analysis = Schema.Struct({ observations: Schema.Array(AnalysisObservationSchema) });
export const codeList = Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema), analysis: AnalysisViewSchema });
export const projectCheck = Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Unknown), complete: Schema.optional(Schema.Boolean) });
export function server(mode = 'normal'): LanguageServer {
  return { id: 'python-fixture', languageId: 'python', extensions: ['.py'], argv: [process.execPath, 'server.mjs'], cwd: ".", environment: ['LANG'], initializationOptions: { mode }, implementationFiles: ['server.mjs'], sourceFiles: [], budgets: { totalMs: 5000, requestMs: 500 }, profile: { version: 'fixture-v1', serverVersion: '1.0.0', commentPrefixes: ['#'], declarationKinds: [5, 6, 12], symbolShape: 'document-symbol', decorators: 'at-line', leadingComments: true, readiness: { kind: 'progress', token: 'index' }, positionEncodings: ['utf-16'] } };
}
export function consumer(): string {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: ['test'], sourceRoots: ['src'] });
  const repository = new LocalRepository(root);
  try {
    createDocument(repository, 'feature', { id: 'sample', title: 'Sample' });
    createDocument(repository, 'use-case', { id: 'sample', feature: 'sample', title: 'Sample' });
  } finally { repository.close(); }
  buildSync({ entryPoints: ['test/fixtures/lsp-server.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(root, 'server.mjs'), logLevel: 'silent' });
  write(root, 'src/sample.py', source);
  write(root, 'test/sample.py', `# @use-case ${target}\n# @name native-sample\ndef test_sample():\n    helper()\n`);
  write(root, 'test/helper.py', 'def helper():\n    implementation()\n');
  writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [server()] });
  return root;
}

export { packageBin };
export { createDocument };
export { createConsumer };
export { installedConcordCli };
export { assert };
export { execFileSync };
export { spawn };
export { spawnSync };
export { copyFileSync };
export { mkdtempSync };
export { mkdirSync };
export { readFileSync };
export { rmSync };
export { writeFileSync };
export { dirname };
export { join };
export { resolve };
export { tmpdir };
export { test };
export { Effect };
export { Schema };
export { buildSync };
export { analysisBudgets };
export { LanguageServersSchema };
export type { LanguageServer };
export { documentSymbols };
export { positionOffset };
export { bindSymbol };
export { LspConnection };
export { AnalysisObservationSchema };
export { AnalysisViewSchema };
export { historicalAnalysis };
export { relevanceFor };
export { CodeDeclarationSchema };
export { decode };
export type { AnnotatedCase };
export type { DocumentRecord };
export { observation };
export { LocalRepository };
export { withPersistentCache };
export { observeOwnedProcessGroup };
export { hydrateQueryValue };
export { TraceShowValue };
export { pollUntil };
export { readProjectConfig };
export { writeProjectConfig };
export { packConcord };
