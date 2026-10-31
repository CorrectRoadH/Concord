import { createRequire, packageBin, createConsumer, packConcord, installConcord, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, TemplatesOutput, scratch, cli, call, callString, readPage, savePage, consumer, write } from '../support/cli-fixture.js';



// @use-case docs/feature/documentation-quality/use-case/apply-controlled-writing.md
test('C10 C22 C24 C25: packed invalid policy rejection and controlled checks keep cache-independent public results', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('controlled-writing-v3');
 const path = 'docs/concord-writing.json';
 const original = { format: 'concord.writing/v2', roots: ['docs/corpus.md'], bannedTerms: [], sentenceLength: 100, paragraphLength: 200 };
 write(root, path, JSON.stringify(original));
 write(root, 'docs/corpus.md', '1. Read the read result.\n\nThe cache is cleared.\n');
 assert.equal(call(root, ['docs', 'check'], ErrorOutput, '', 1).error, 'InvalidWritingPolicy');
 const shown = call(root, ['writing', 'show'], Schema.Struct({ digest: Schema.String, source: Schema.String, state: Schema.String }));
 assert.equal(shown.state, 'invalid');
 assert.equal(readFileSync(join(root, path), 'utf8'), shown.source);
 const policy = { ...original, format: 'concord.writing/v3', controlled: { language: 'en', procedural: { singleInstruction: true, verbs: { en: [{ lemma: 'read' }] } }, passiveVoice: { en: true, participles: ['cleared'] } } };
 const current = call(root, ['writing', 'show'], DigestOutput);
 call(root, ['writing', 'set', '--body', '-', '--if-unchanged', current.digest], Ack, JSON.stringify(policy));
 const Report = Schema.Struct({ complete: Schema.Boolean, findings: Schema.Array(Schema.Unknown), inputDigest: Schema.String });
 call(root, ['cache', 'clear'], Ack);
 const cold = call(root, ['docs', 'check'], Report, '', 1);
 call(root, ['cache', 'rebuild'], Ack);
 assert.deepEqual(call(root, ['docs', 'check'], Report, '', 1), cold);
 // Corrupt only disposable projection rows, retaining the native ownership inode.
 const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: false });
 try { for (const table of ['annotation_cache', 'code_cache'] as const) for (const row of database.scan(table)) database.put(table, [{ key: row.key, payload: '{invalid' }]); }
 finally { database.close(); }
 assert.deepEqual(call(root, ['docs', 'check'], Report, '', 1), cold);
 call(root, ['cache', 'clear'], Ack);
 assert.deepEqual(call(root, ['docs', 'check'], Report, '', 1), cold);
 write(root, 'profile.json', JSON.stringify(policy));
 assert.deepEqual(call(root, ['docs', 'check', '--rules', 'profile.json'], Schema.Struct({ findings: Schema.Array(Schema.Unknown) }), '', 1).findings.map(value => { const finding = value as { source?: unknown; sources?: unknown }; return { ...finding, source: undefined, sources: undefined }; }), cold.findings.map(value => { const finding = value as { source?: unknown; sources?: unknown }; return { ...finding, source: undefined, sources: undefined }; }));
 const saved = call(root, ['writing', 'show'], DigestOutput);
 const invalid = { ...policy, controlled: { sentence: { en: { procedural: 0 } } } };
 assert.equal(call(root, ['writing', 'set', '--body', '-', '--if-unchanged', saved.digest], ErrorOutput, JSON.stringify(invalid), 1).error, 'InvalidWritingPolicy');
 write(root, 'profile.json', JSON.stringify(invalid));
 assert.equal(call(root, ['docs', 'check', '--rules', 'profile.json'], ErrorOutput, '', 1).error, 'InvalidWritingPolicy');
 write(root, 'profile.json', JSON.stringify({ ...policy, controlled: { approvedWords: { en: Array(4097).fill('word') } } }));
 assert.equal(call(root, ['docs', 'check', '--rules', 'profile.json'], ErrorOutput, '', 1).error, 'WritingBudgetExceeded');
})));
