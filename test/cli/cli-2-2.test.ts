import { assert, readFileSync, join, test, Effect, Schema, readProjectConfig, writeProjectConfig, digest, caseDiscriminator, deriveTestReference, Ack, ErrorOutput, CheckOutput, call, consumer, write } from '../support/cli-fixture.ts';


// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('installed CLI returns a named failure for a known skipped declaration',()=>Effect.runPromise(Effect.promise(async ()=>{
 const root=consumer('skipped');
 writeProjectConfig(root, { ...readProjectConfig(root), runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 60000 } });
 (await call(root,['new', 'feature','skip-feature','--title','Skip feature','--body','-'],Ack));
 write(root,'test/skipped.test.mjs',"import test from 'node:test';\n// @feature docs/feature/skip-feature/README.md\n// @status retired\ntest.skip('skipped',()=>{});\n");
 write(root,'test/browser.test.ts',"// @feature docs/feature/skip-feature/README.md\ntest.describe('session', () => { test('fails closed', () => {}); });\n");
 const skippedCase = deriveTestReference('test/skipped.test.mjs', 'test/skipped.test.mjs', caseDiscriminator('docs/feature/skip-feature/README.md', 0));
 assert.equal((await call(root,['check'],CheckOutput)).ok,true);
 assert.equal((await call(root,['test','run',skippedCase],ErrorOutput,'',1)).error,'CaseNotRunnable');
})));


// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('packed concepts actions preserve Markdown and allow generic whole-file saves', () => Effect.runPromise(Effect.promise(async () => {
 const root = consumer('markdown-catalog-cli');
 (await call(root, ['new', 'feature', 'catalog', '--title', 'Catalog'], Ack));
 const path = 'docs/feature/catalog/concepts.md';
 const source = '# Terms\r\n\r\n## Memory {#memory}\r\n\r\nA durable finding.\r\n\r\n<!-- Author spacing -->\r\n';
 const receiptSchema = Schema.Struct({ digest: Schema.String });
 const created = (await call(root, ['action', '--input', '-'], receiptSchema, JSON.stringify({ action: 'document.set', path, body: source, expectedDigest: null })));
 assert.equal(readFileSync(join(root, path), 'utf8'), source);
 const updated = source + '\r\n';
 const saved = (await call(root, ['action', '--input', '-'], receiptSchema, JSON.stringify({ action: 'document.set', path, body: updated, expectedDigest: created.digest })));
 assert.equal((await call(root, ['action', '--input', '-'], ErrorOutput, JSON.stringify({ action: 'document.set', path, body: source, expectedDigest: created.digest }), 1)).error, 'FileChangedSinceRead');
 (await call(root, ['action', '--input', '-'], Ack, JSON.stringify({ action: 'document.set', path, body: source, expectedDigest: saved.digest })));
 assert.equal(readFileSync(join(root, path), 'utf8'), source);
 write(root, 'docs/ignored/concepts.json', 'not parsed or reported');
 const index = (await call(root, ['concepts', 'index'], Schema.Struct({ catalogs: Schema.Array(Schema.Struct({ path: Schema.String })), diagnostics: Schema.Array(Schema.Unknown) })));
 assert(index.catalogs.every(item => item.path.endsWith('/concepts.md')));
 assert.equal(index.diagnostics.length, 0);
})));
