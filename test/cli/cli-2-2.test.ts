import { assert, test, Effect, readProjectConfig, writeProjectConfig, caseDiscriminator, deriveTestReference, Ack, ErrorOutput, CheckOutput, call, consumer, write } from '../support/cli-fixture.ts';


// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('installed CLI returns a named failure for a known skipped declaration',()=>Effect.runPromise(Effect.promise(async ()=>{
 const root=(await consumer('skipped'));
 writeProjectConfig(root, { ...(await readProjectConfig(root)), runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 60000 } });
 (await call(root,['new', 'feature','skip-feature','--title','Skip feature','--body','-'],Ack));
 write(root,'test/skipped.test.mjs',"import test from 'node:test';\n// @feature docs/feature/skip-feature/README.md\n// @status retired\ntest.skip('skipped',()=>{});\n");
 write(root,'test/browser.test.ts',"// @feature docs/feature/skip-feature/README.md\ntest.describe('session', () => { test('fails closed', () => {}); });\n");
 const skippedCase = deriveTestReference('test/skipped.test.mjs', 'test/skipped.test.mjs', caseDiscriminator('docs/feature/skip-feature/README.md', 0));
 assert.equal((await call(root,['check'],CheckOutput)).ok,true);
 assert.equal((await call(root,['test','run',skippedCase],ErrorOutput,'',1)).error,'CaseNotRunnable');
})));
