import { assert, test, Effect, Schema, digest, Ack, ErrorOutput, AnnotationOutput, call, consumer, write } from '../support/cli-fixture.ts';


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name packed-operation-boundaries
test('packed local operations isolate unrelated malformed contracts and check reports all failures', () => Effect.runPromise(Effect.promise(async () => {
 const root = consumer('operation-boundaries');
 (await call(root, ['new', 'feature', 'target', '--title', 'Target'], Ack));
 (await call(root, ['new', 'feature', 'broken-a', '--title', 'Broken A'], Ack));
 (await call(root, ['new', 'feature', 'broken-b', '--title', 'Broken B'], Ack));
 for (const id of ['broken-a', 'broken-b']) write(root, `docs/feature/${id}/README.md`, '---\nformat: concord.document/v1\nkind: feature\n---\n# Incomplete owner\n');
 const target = 'docs/feature/target/README.md';
 assert.match((await call(root, ['code', 'marker', '--scope', 'file', '--contract', target], AnnotationOutput)).snippet, /@concord-implements docs\/feature\/target\/README.md/u);
 assert.match((await call(root, ['test', 'marker', '--contract', target], AnnotationOutput)).snippet, /@feature docs\/feature\/target\/README.md/u);
 (await call(root, ['new', 'memory', 'repair-note', '--title', 'Repair note'], Ack));
 const index = (await call(root, ['list', 'memory'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String })) })));
 const note = index.documents.find(record => record.path === 'memory/repair-note.md');
 assert.ok(note);
 (await call(root, ['action', '--input', '-'], Ack, JSON.stringify({ action: 'document.set', path: note.path, body: '# Repair note\n\nObserved broken contract metadata.\n', expectedDigest: note.digest })));
 const recalled = (await call(root, ['memory', 'search', 'broken contract'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ body: Schema.String })) })));
 assert.equal(recalled.documents.length, 1);
 assert.match(recalled.documents[0]!.body, /Observed broken contract metadata/u);
 const listed = (await call(root, ['list', 'memory'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ id: Schema.String })) })));
 assert.equal(listed.documents[0]?.id, 'repair-note');
 (await call(root, ['new', 'issue', 'repair-observation', '--title', 'Repair observation'], Ack));
 assert.equal((await call(root, ['list', 'issue'], Schema.Struct({ documents: Schema.Array(Schema.Struct({ id: Schema.String })) }))).documents[0]?.id, 'repair-observation');
 const checked = (await call(root, ['check'], Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ path: Schema.String })) }), '', 1));
 assert.equal(checked.ok, false);
 for (const id of ['broken-a', 'broken-b']) assert.ok(checked.findings.some(finding => finding.path === `docs/feature/${id}/README.md`));
 assert.equal((await call(root, ['code', 'marker', '--scope', 'file', '--contract', 'docs/feature/broken-a/README.md'], ErrorOutput, '', 1)).error, 'InvalidData');
})));
