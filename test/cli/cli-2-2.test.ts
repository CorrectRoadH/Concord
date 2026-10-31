import { createRequire, packageBin, createConsumer, packConcord, installConcord, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, authorDesignFixture, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, DecisionOutput, MemoryLifecycleOutput, TemplatesOutput, scratch, cli, call, callString, clearDecision, readPage, savePage, consumer, write } from '../support/cli-fixture.js';


// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('installed CLI returns a named failure for a known skipped declaration',()=>Effect.runPromise(Effect.sync(()=>{
 const root=consumer('skipped');
 writeProjectConfig(root, { ...readProjectConfig(root), runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 60000 } });
 call(root,['new', 'feature','skip-feature','--title','Skip feature','--body','-'],Ack);
 write(root,'test/skipped.test.mjs',"import test from 'node:test';\n// @feature docs/feature/skip-feature/README.md\n// @status retired\ntest.skip('skipped',()=>{});\n");
 write(root,'test/browser.test.ts',"// @feature docs/feature/skip-feature/README.md\ntest.describe('session', () => { test('fails closed', () => {}); });\n");
 const skippedCase = deriveTestReference('test/skipped.test.mjs', 'test/skipped.test.mjs', caseDiscriminator('docs/feature/skip-feature/README.md', 0));
 assert.equal(call(root,['check'],CheckOutput).ok,true);
 assert.equal(call(root,['test','run',skippedCase],ErrorOutput,'',1).error,'CaseNotRunnable');
})));


// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('packed concepts actions preserve Markdown and allow generic whole-file saves', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('markdown-catalog-cli');
 call(root, ['new', 'feature', 'catalog', '--title', 'Catalog'], Ack);
 const path = 'docs/feature/catalog/concepts.md';
 const source = '# Terms\r\n\r\n## Memory {#memory}\r\n\r\nA durable finding.\r\n\r\n<!-- Author spacing -->\r\n';
 const receiptSchema = Schema.Struct({ source: Schema.String, digest: Schema.String });
 const created = call(root, ['concepts', 'set', '--path', path, '--body', '-', '--expected-digest', 'null'], receiptSchema, source);
 assert.equal(created.source, source);
 assert.equal(readFileSync(join(root, path), 'utf8'), source);
 const updated = source + '\r\n';
 const saved = call(root, ['action', '--input', '-'], receiptSchema, JSON.stringify({ action: 'concepts.set', path, source: updated, expectedDigest: created.digest }));
 assert.equal(saved.source, updated);
 assert.equal(call(root, ['concepts', 'set', '--path', path, '--body', '-', '--expected-digest', created.digest], ErrorOutput, source, 1).error, 'PreimageChanged');
 call(root, ['action', '--input', '-'], Ack, JSON.stringify({ action: 'document.set', path, body: source, expectedDigest: saved.digest }));
 assert.equal(readFileSync(join(root, path), 'utf8'), source);
 write(root, 'docs/ignored/concepts.json', 'not parsed or reported');
 const index = call(root, ['concepts', 'index'], Schema.Struct({ catalogs: Schema.Array(Schema.Struct({ path: Schema.String })), diagnostics: Schema.Array(Schema.Unknown) }));
 assert(index.catalogs.every(item => item.path.endsWith('/concepts.md')));
 assert.equal(index.diagnostics.length, 0);
})));
