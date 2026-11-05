import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { ConcordError, type DocumentKind } from '../../src/model/index.js';
import { adoptRoadmap, documentShow, type CreateDocumentInput } from '../../src/app/index.js';
import { loadDocuments } from '../../src/domain/documents/index.js';
import { LocalRepository } from '../support/repository.js';
import { createDocument } from '../support/operations.js';
import { createConsumer } from '../support/consumer.js';
import { writeProjectConfig } from '../support/support.js';
const Ack = Schema.Struct({});
const ErrorOutput = Schema.Struct({ error: Schema.String });
function result<A>(root: string, operation: (repo: LocalRepository) => unknown, schema: Schema.ConstraintDecoder<A, never>, status = 0): A {
  const repo = new LocalRepository(root);
  try {
    let value: unknown;
    try { value = repo.snapshot(() => operation(repo)); }
    catch (cause) {
      assert.equal(status, 1, String(cause)); assert.ok(cause instanceof ConcordError);
      return Schema.decodeUnknownSync(schema)({ error: cause.code });
    }
    assert.equal(status, 0); return Schema.decodeUnknownSync(schema)(value);
  } finally { repo.close(); }
}
const create = <A>(root: string, kind: DocumentKind, id: string, title: string, schema: Schema.ConstraintDecoder<A, never>, input: Partial<CreateDocumentInput> = {}, status = 0) => result(root, repo => createDocument(repo, kind, { id, title, ...input }), schema, status);
const show = <A>(root: string, selector: string, kind: DocumentKind, schema: Schema.ConstraintDecoder<A, never>) => result(root, repo => documentShow(repo, selector, kind), schema);
const consumer = (_name: string) => { const root = createConsumer(); writeProjectConfig(root, { testRoots: ['test', 'tests'] }); return root; };
const write = (root: string, path: string, source: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); };

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed create selects optional pages, keeps README required, and rejects invalid selections before writing', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('optional-pages');
 try {
 const only = create(root, 'feature', 'minimal', 'Minimal', Schema.Struct({ changedPaths: Schema.Array(Schema.String) }));
 assert.deepEqual(only.changedPaths, ['docs/feature/minimal/README.md']);
 assert.doesNotMatch(readFileSync(join(root, only.changedPaths[0]!), 'utf8'), /\]\(/);
 create(root, 'feature', 'selected', 'Selected', Ack, { pages: ['cli', 'library', 'use-case'] });
 const base = 'docs/feature/selected/';
 const readme = readFileSync(join(root, base, 'README.md'), 'utf8');
 for (const match of readme.matchAll(/\]\(([^)]+)\)/g)) assert.equal(existsSync(join(root, base, match[1]!)), true);
 assert.equal(existsSync(join(root, base, 'architecture.md')), false);
 assert.equal(existsSync(join(root, base, 'lifecycle.md')), false);
 assert.equal(result(root, repo => ({ documents: loadDocuments(repo, ['use-case']) }), Schema.Struct({ documents: Schema.Array(Schema.Unknown) })).documents.length, 0);
 assert.equal(readFileSync(join(root, base, 'README.md'), 'utf8'), readme);
 const author = '# Custom\n\nKeep [my link](custom.md).\n';
 create(root, 'feature', 'custom', 'Custom', Ack, { body: author, pages: ['cli'] });
 const shown = show(root, 'custom', 'feature', Schema.Struct({
   document: Schema.Struct({ path: Schema.String, metadata: Schema.Unknown, digest: Schema.String }),
   useCases: Schema.Array(Schema.Unknown), tests: Schema.Array(Schema.Unknown), codeDeclarations: Schema.Array(Schema.Unknown), findings: Schema.Array(Schema.Unknown),
 }));
 assert.equal(shown.document.path, 'docs/feature/custom/README.md');
 assert.deepEqual(shown.useCases, []);
 assert.equal('body' in shown.document, false, 'feature show leaves author prose to direct file reads');
 create(root, 'use-case', 'custom-flow', 'Custom flow', Ack, { feature: 'custom' });
 const featureRelations = show(root, 'custom', 'feature', Schema.Struct({ useCases: Schema.Array(Schema.Struct({ path: Schema.String })) }));
 assert.deepEqual(featureRelations.useCases.map(item => item.path), ['docs/feature/custom/use-case/custom-flow.md']);
 const useCaseRelations = show(root, 'custom-flow', 'use-case', Schema.Struct({
   document: Schema.Struct({ path: Schema.String }), outgoing: Schema.Array(Schema.Struct({ to: Schema.String })),
 }));
 assert.equal(useCaseRelations.document.path, 'docs/feature/custom/use-case/custom-flow.md');
 assert.ok(useCaseRelations.outgoing.some(edge => edge.to === 'docs/feature/custom/README.md'));
 create(root, 'feature', 'preview', 'Preview', Ack, { pages: ['cli'], dryRun: true });
 assert.equal(existsSync(join(root, 'docs/feature/preview')), false);
 for (const [id, pages, error] of [['unknown', 'other', 'InvalidInput'], ['duplicate', 'cli,cli', 'InvalidInput'], ['empty', 'cli,', 'InvalidInput']] as const) {
   assert.equal(create(root, 'feature', id, id, ErrorOutput, { pages: pages.split(',') }, 1).error, error);
   assert.equal(existsSync(join(root, 'docs/feature', id)), false);
 }
 const engineering = create(root, 'engineering', 'small', 'Small', Schema.Struct({ changedPaths: Schema.Array(Schema.String) }));
 assert.deepEqual(engineering.changedPaths, ['docs/engineering/small/README.md']);
 const engineeringShow = show(root, 'small', 'engineering', Schema.Struct({ document: Schema.Struct({ path: Schema.String }) }));
 assert.equal(engineeringShow.document.path, 'docs/engineering/small/README.md');
 assert.equal('body' in engineeringShow.document, false);
 write(root, 'docs/feature/conflict/cli.md', '# Existing\n');
 assert.equal(create(root, 'feature', 'conflict', 'Conflict', ErrorOutput, { pages: ['cli'] }, 1).error, 'DocumentExists');
 assert.equal(existsSync(join(root, 'docs/feature/conflict/README.md')), false);
 assert.equal(readFileSync(join(root, 'docs/feature/conflict/cli.md'), 'utf8'), '# Existing\n');
 create(root, 'design', 'minimal-design', 'Design', Ack);
 assert.equal(existsSync(join(root, 'docs/design/minimal-design.md')), true);
 assert.equal(existsSync(join(root, 'docs/design/minimal-design')), false);
 create(root, 'roadmap', 'minimal-roadmap', 'Roadmap', Ack);
 result(root, repo => adoptRoadmap(repo, 'minimal-roadmap', 'adopted-minimal'), Ack);
 assert.equal(existsSync(join(root, 'docs/feature/adopted-minimal/README.md')), true);
 assert.equal(existsSync(join(root, 'docs/feature/adopted-minimal/cli.md')), false);
 } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md#页面选择
test('all three package kinds select the nine page templates without creating a Use Case journey', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('all-page-kinds');
 const pages = ['use-case', 'cli', 'library', 'api', 'format', 'ui', 'performance', 'architecture', 'data-model'];
 try {
 for (const kind of ['feature', 'engineering', 'roadmap'] as const) {
   const selected = create(root, kind, `selected-${kind}`, 'Selected', Schema.Struct({ changedPaths: Schema.Array(Schema.String) }), { pages });
   const base = `docs/${kind}/selected-${kind}/`;
   assert.deepEqual([...selected.changedPaths].sort(), [base + 'README.md', ...pages.map(page => base + (page === 'use-case' ? 'use-case/README.md' : `${page}.md`))].sort());
   const readme = readFileSync(join(root, base, 'README.md'), 'utf8');
   assert.doesNotMatch(readme, /\{\{entryPoints\}\}/u);
   for (const page of pages) {
     const path = page === 'use-case' ? 'use-case/README.md' : `${page}.md`;
     assert.ok(readme.includes(`](${path})`), `${kind}: missing navigation to ${path}`);
     assert.match(readFileSync(join(root, base, path), 'utf8'), /^# Selected\n/u);
   }
   assert.equal(existsSync(join(root, base, 'concepts.md')), false);
   assert.equal(existsSync(join(root, base, 'writing.md')), false);
   const minimal = create(root, kind, `minimal-${kind}`, 'Minimal', Schema.Struct({ changedPaths: Schema.Array(Schema.String) }));
   assert.deepEqual(minimal.changedPaths, [`docs/${kind}/minimal-${kind}/README.md`]);
   const minimalBody = readFileSync(join(root, minimal.changedPaths[0]!), 'utf8');
   assert.doesNotMatch(minimalBody, /\{\{entryPoints\}\}|\]\(|supporting pages|mental model/u);
   for (const invalid of [['scope'], ['concepts'], ['writing'], ['api', 'api']]) {
     assert.equal(create(root, kind, `invalid-${kind}`, 'Invalid', ErrorOutput, { pages: invalid }, 1).error, 'InvalidInput');
     assert.equal(existsSync(join(root, `docs/${kind}/invalid-${kind}`)), false);
   }
 }
 assert.deepEqual(result(root, repo => ({ documents: loadDocuments(repo, ['use-case']) }), Schema.Struct({ documents: Schema.Array(Schema.Unknown) })).documents, []);
 for (const kind of ['design', 'issue', 'memory', 'use-case'] as const) {
   assert.equal(create(root, kind, `invalid-${kind}`, 'Invalid', ErrorOutput, { pages: ['api'] }, 1).error, 'InvalidInput');
   const path = kind === 'memory' ? 'memory/invalid-memory.md' : kind === 'issue' ? 'docs/issues/invalid-issue.md' : `docs/${kind}/invalid-${kind}.md`;
   assert.equal(existsSync(join(root, path)), false);
 }
 } finally { rmSync(root, { recursive: true, force: true }); }
})));
