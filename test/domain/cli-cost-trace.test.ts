import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { digest, caseDiscriminator, deriveTestReference } from '../../src/model/index.ts';
import { executeQuery, executeViewAction, type QueryRequest } from '../../src/app/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { runApplication } from '../support/repository.ts';
import { writeProjectConfig } from '../support/support.ts';
const Ack = Schema.Struct({});
const ErrorOutput = Schema.Struct({ error: Schema.String });
const AnnotationOutput = Schema.Struct({ snippet: Schema.String });
const CheckOutput = Schema.Struct({ ok: Schema.Boolean });
const TraceOutput = Schema.Struct({ tests: Schema.Array(Schema.Struct({ id: Schema.String })) });
const DoctorOutput = Schema.Struct({ cases: Schema.Int });
const OwnerOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Unknown }) });
// @use-case docs/feature/local-sdlc/use-case/review-traceability.md
test('editable packages connect supporting-page tests to their Feature', () => Effect.runPromise(Effect.promise(async () => {
 const root = createConsumer();
 writeProjectConfig(root, { testRoots: ['test', 'tests'] });
 async function query<A>(request: QueryRequest, schema: Schema.ConstraintDecoder<A, never>): Promise<A> {
   const result = await runApplication(executeQuery(root, request));
   assert.equal(result.exitCode, 0);
   return Schema.decodeUnknownSync(schema)(result.value);
 }
 async function action<A>(input: unknown, schema: Schema.ConstraintDecoder<A, never>, status = 0): Promise<A> {
   const result = await runApplication(executeViewAction(root, input)).then(value => ({ status: 0, value }), error => ({ status: 1, value: { error: error.code } }));
   assert.equal(result.status, status, JSON.stringify(result.value));
   return Schema.decodeUnknownSync(schema)(result.value);
 }
 function readPage(path: string) { const body = readFileSync(join(root, path), 'utf8'); return { body, digest: digest(body) }; }
 function savePage(path: string, body: string, expectedDigest: string, status = 0) {
   return action({ action: 'document.set', path, body, expectedDigest }, status === 0 ? Ack : ErrorOutput, status) as Promise<{ error?: string }>;
 }
 function write(path: string, source: string) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); }

 const guide = readFileSync(join(root, 'docs/concord.md'), 'utf8');
 assert.match(guide, /concord test list/);
 assert.match(guide, /a product direction in the same genre as Feature that has not been adopted yet\. Its design is incomplete, or it is designed but not scheduled/u);
 assert.match(guide, /Behavior pages \(Feature README, Use Case, cli, library\) state commands, real human and JSON output, exit codes, and named errors\./u);
 assert.match(guide, /The architecture page states how the Feature is implemented\. Run `concord --skill document` for the full rules\./u);
 for (const path of ['docs/README.md', 'docs/_template/roadmap/use-case/README.md', 'docs/_template/design/README.md', 'docs/_template/engineering/README.md', 'docs/concepts.md', 'docs/architecture.md', 'docs/_template/memory/README.md']) assert.equal(existsSync(join(root, path)), true, path);
 assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /BEGIN CONCORD AGENT INSTRUCTIONS[\s\S]*concord trace gaps --json/u);
 (await action({ action: 'document.create', kind: 'feature', id: 'accounts', title: 'Accounts', pages: ['library', 'cli', 'architecture', 'use-case'] }, Ack));
 for (const page of ['README.md', 'library.md', 'cli.md', 'architecture.md', 'use-case/README.md']) assert.equal(existsSync(join(root, 'docs/feature/accounts', page)), true, page);
 (await action({ action: 'document.create', kind: 'feature', id: 'other', title: 'Other' }, Ack));
 (await action({ action: 'document.create', kind: 'engineering', id: 'ci', title: 'Continuous integration' }, Ack));
 const page = readPage('docs/feature/accounts/cli.md');
 (await savePage('docs/feature/accounts/cli.md', '# Accounts CLI\n\n## Sign in\n\nReject expired tokens.\n', page.digest));
 assert.equal((await savePage('docs/feature/accounts/cli.md', '# Stale\n', page.digest, 1)).error, 'FileChangedSinceRead');
 const ownerBefore = (await query({ name: 'documents.show', input: { id: 'accounts' } }, OwnerOutput)).document;
 const readme = readPage('docs/feature/accounts/README.md');
 assert.ok(!readme.body.startsWith('---'));
 (await savePage('docs/feature/accounts/README.md', '# Accounts\n\nUsers sign in with valid credentials.\n', readme.digest));
 assert.deepEqual((await query({ name: 'documents.show', input: { id: 'accounts' } }, OwnerOutput)).document.metadata, ownerBefore.metadata);
 (await action({ action: 'document.create', kind: 'issue', id: 'expired', title: 'Expired token' }, Ack));
 const annotation = (await action({ action: 'test.marker', contract: 'docs/feature/accounts/cli.md#sign-in', issues: ['docs/issues/expired.md'] }, AnnotationOutput));
 assert.equal(existsSync(join(root, 'test')), false, 'annotate must not edit test sources');
 write('test/accounts.test.mjs', `import test from 'node:test';\n${annotation.snippet}test('rejects expired tokens', () => {});\n`);
 const accountCase = deriveTestReference('test/accounts.test.mjs', 'test/accounts.test.mjs', caseDiscriminator('docs/feature/accounts/cli.md#sign-in', 0));
 assert.equal((await query({ name: 'check', input: {} }, CheckOutput)).ok, true);
 const tracedTest = (await query({ name: 'trace.show', input: { reference: 'accounts' } }, TraceOutput)).tests[0];
 assert.ok(tracedTest);
 assert.equal(tracedTest.id, accountCase);
 assert.equal((await query({ name: 'trace.show', input: { reference: 'other' } }, TraceOutput)).tests.length, 0);
 assert.match((await query({ name: 'review', input: { reference: 'accounts' } }, Schema.String)), new RegExp(accountCase));
 assert.equal((await action({ action: 'doctor' }, DoctorOutput)).cases, 1);
})));
