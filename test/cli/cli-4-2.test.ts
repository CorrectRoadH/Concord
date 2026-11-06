import { renderWritingPolicy } from '../../src/model/index.js';
import { createRequire, packageBin, createConsumer, sourceConcord, prepareSourceConsumer, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, TemplatesOutput, scratch, cli, call, callString, readPage, savePage, consumer, write } from '../support/cli-fixture.js';


// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('packed writing reports JSON findings, exit one and named unsafe input failures', () => {
 const root = consumer('writing-boundaries');
 const policy = { roots: ['guide'] as [string, ...string[]], bannedTerms: [{ term: 'bad', use: 'clear', why: 'test rule' }] };
 write(root, 'docs/writing.md', renderWritingPolicy(policy));
 write(root, 'guide/page.md', 'clear.');
 assert.equal(call(root, ['docs', 'check'], CheckOutput).ok, true);
 write(root, 'guide/page.md', 'bad.');
 const report = call(root, ['docs', 'check'], Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ rule: Schema.String })) }), '', 1);
 assert.equal(report.ok, false);
 assert.equal(report.findings[0]?.rule, 'bannedTerm');
 write(root, 'docs/writing.md', renderWritingPolicy({ ...policy, roots: ['missing'] }));
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'WritingInputNotFound');
 write(root, 'docs/writing.md', renderWritingPolicy(policy));
 symlinkSync(join(root, 'guide/page.md'), join(root, 'guide/escape.md'));
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'UnsafePath');
});

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('packed scoped Markdown owners are discovered after direct editing', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('scoped-owner-cli');
 const ownerPath = 'docs/feature/sample/writing.md';
 const catalogPath = 'docs/feature/sample/concepts.md';
 assert.equal(call(root, ['writing', 'show', '--path', ownerPath], Schema.Struct({ state: Schema.String })).state, 'missing');
 write(root, ownerPath, renderWritingPolicy({ bannedTerms: [] }));
 write(root, catalogPath, '# Terms\n\n## Feedback {#feedback}\n\nA response\n');
 write(root, 'docs/feature/sample/page.md', 'Feedback.\n');
 assert.equal(call(root, ['concepts', 'show', '--path', catalogPath], Schema.Struct({ state: Schema.String })).state, 'valid');
 assert(call(root, ['writing', 'index'], Schema.Struct({ scopes: Schema.Array(Schema.Struct({ scope: Schema.String })) })).scopes.some(item => item.scope === 'docs/feature/sample'));
 assert(call(root, ['concepts', 'index'], Schema.Struct({ concepts: Schema.Array(Schema.Struct({ reference: Schema.String })) })).concepts.some(item => item.reference === catalogPath + '#feedback'));
 assert.equal(call(root, ['writing', 'check', '--path', ownerPath], CheckOutput).ok, true);
})));
