import { assert, test, Effect, Schema, caseDiscriminator, deriveTestReference, Ack, CheckOutput, call, consumer, write } from '../support/cli-fixture.ts';


// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('installed CLI preserves retired markers without inferring framework skip state',()=>Effect.runPromise(Effect.promise(async ()=>{
 const root=(await consumer('skipped'));
 (await call(root,['new', 'feature','skip-feature','--title','Skip feature','--body','-'],Ack));
 write(root,'test/skipped.test.mjs',"import test from 'node:test';\n// @feature docs/feature/skip-feature/README.md\n// @status retired\ntest.skip('skipped',()=>{});\n");
 write(root,'test/browser.test.ts',"// @feature docs/feature/skip-feature/README.md\ntest.describe('session', () => { test('fails closed', () => {}); });\n");
 const skippedCase = deriveTestReference('test/skipped.test.mjs', 'test/skipped.test.mjs', caseDiscriminator('docs/feature/skip-feature/README.md', 0));
 assert.equal((await call(root,['check'],CheckOutput)).ok,true);
 const shown = await call(root, ['test', 'show', skippedCase], Schema.Struct({ case: Schema.Struct({ id: Schema.String, status: Schema.String, skipped: Schema.Boolean }) }));
 assert.deepEqual(shown.case, { id: skippedCase, status: 'retired', skipped: false });
})));
