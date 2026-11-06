import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { formatUseCase, renameUseCaseStep, useCaseSteps } from '../../src/app/index.js';
import { createConsumer } from '../support/consumer.js';
import { createDocument } from '../support/operations.js';
import { action, query, withRepository } from '../support/application-fixture.js';
import { writeProjectConfig } from '../support/support.js';
const Ack = Schema.Struct({});
const DigestOutput = Schema.Struct({ digest: Schema.String });
const AnnotationOutput = Schema.Struct({ snippet: Schema.String });
const CheckOutput = Schema.Struct({ ok: Schema.Boolean });
const write = (root: string, path: string, source: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); };

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#link-declarations
// @name packed-steps-navigation-and-maintenance
test('steps C15 C16 C18 navigate exact steps, preserve examples and rename through one journal', async () => {
 const root = createConsumer();
 try {
 writeProjectConfig(root, { sourceRoots: ['src'], testRoots: ['test'] });
 withRepository(root, repo => createDocument(repo, 'feature', { id: 'journey', title: 'Journey' }));
 withRepository(root, repo => createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'journey' }));
 const path = 'docs/feature/journey/use-case/flow.md';
 const owner = await query(root, { name: 'documents.show', input: { id: path } }, Schema.Struct({ document: DigestOutput }));
 await action(root, { action: 'document.set', path, body: '# Flow\n\n## Details\n\n1. Reject {#reject-token}\n2. Report\n\n## Acceptance\n\n1. Leave unmarked\n', expectedDigest: owner.document.digest }, Ack);
 write(root, 'test/flow.ts', `// @use-case ${path}#reject-token\n// @name stable\n\n// @use-case ${path}#details\n\n// @use-case ${path}\n\n// pytest.mark.unrelated\nconst fake = '// @use-case ${path}#reject-token';\n`);
 write(root, 'src/flow.ts', `// @concord-file\n// @concord-implements ${path}#reject-token\nexport const flow = 1;\n`);
 write(root, 'docs/feature/journey/architecture.md', `[Flow](use-case/flow.md#reject-token)\n\n\`[Example](use-case/flow.md#reject-token)\`\n`);
 const steps = Schema.Struct({ steps: Schema.Array(Schema.Struct({ id: Schema.String, testCount: Schema.Int, codeCount: Schema.Int })), lists: Schema.Array(Schema.Struct({ ordinal: Schema.Int, marked: Schema.Int })) });
 const initial = Schema.decodeUnknownSync(steps)(withRepository(root, repo => useCaseSteps(repo, path)));
 assert.deepEqual(initial.steps, [{ id: 'reject-token', testCount: 1, codeCount: 1 }]);
 assert.equal(initial.lists[1]?.marked, 0);
 await query(root, { name: 'check', input: {} }, CheckOutput);
 withRepository(root, repo => formatUseCase(repo, path));
 assert.deepEqual(Schema.decodeUnknownSync(steps)(withRepository(root, repo => useCaseSteps(repo, path))).steps.map(step => step.id), ['reject-token', 'step-1']);
 const result = Schema.decodeUnknownSync(Schema.Struct({ affectedCases: Schema.Array(Schema.Struct({ before: Schema.String, after: Schema.String, named: Schema.Boolean })) }))(withRepository(root, repo => renameUseCaseStep(repo, path, 'reject-token', '拒绝令牌')));
 assert.equal(result.affectedCases[0]?.before, result.affectedCases[0]?.after);
 assert.match(readFileSync(join(root, 'docs/feature/journey/architecture.md'), 'utf8'), /\[Flow\]\(use-case\/flow.md#拒绝令牌\)/u);
 assert.match(readFileSync(join(root, 'docs/feature/journey/architecture.md'), 'utf8'), /`\[Example\]\(use-case\/flow.md#reject-token\)`/u);
 const trace = await query(root, { name: 'trace.show', input: { reference: path } }, Schema.Struct({ stepGroups: Schema.Array(Schema.Struct({ nonStepAnchors: Schema.Array(Schema.Struct({ ref: Schema.String })), wholeUseCase: Schema.Struct({ tests: Schema.Array(Schema.Unknown) }) })) }));
 assert.equal(trace.stepGroups[0]?.nonStepAnchors[0]?.ref, `${path}#details`);
 assert.equal(trace.stepGroups[0]?.wholeUseCase.tests.length, 1);
 assert.match(await query(root, { name: 'review', input: { reference: path } }, Schema.String), /Step: .*#拒绝令牌/u);
 await query(root, { name: 'check', input: {} }, CheckOutput);
 write(root, 'test/broken.ts', `// @use-case ${path}#missing\n`);
 const broken = await query(root, { name: 'check', input: {} }, Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ code: Schema.String })) }), 1);
 assert.equal(broken.ok, false); assert.ok(broken.findings.some(finding => finding.code === 'AnchorNotFound'));
 } finally { rmSync(root, { recursive: true, force: true }); }
});
