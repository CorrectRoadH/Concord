import { renderWritingPolicy } from '../../src/model/index.ts';
import { assert, symlinkSync, join, test, Schema, ErrorOutput, CheckOutput, call, consumer, write } from '../support/cli-fixture.ts';


// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('packed writing reports JSON findings, exit one and named unsafe input failures', async () => {
 const root = consumer('writing-boundaries');
 const policy = { roots: ['guide'] as [string, ...string[]], bannedTerms: [{ term: 'bad', use: 'clear', why: 'test rule' }] };
 write(root, 'docs/writing.md', renderWritingPolicy(policy));
 write(root, 'guide/page.md', 'clear.');
 assert.equal((await call(root, ['docs', 'check'], CheckOutput)).ok, true);
 write(root, 'guide/page.md', 'bad.');
 const report = (await call(root, ['docs', 'check'], Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ rule: Schema.String })) }), '', 1));
 assert.equal(report.ok, false);
 assert.equal(report.findings[0]?.rule, 'bannedTerm');
 write(root, 'docs/writing.md', renderWritingPolicy({ ...policy, roots: ['missing'] }));
 assert.equal((await call(root, ['docs', 'check'], ErrorOutput, '', 1)).error, 'WritingInputNotFound');
 write(root, 'docs/writing.md', renderWritingPolicy(policy));
 symlinkSync(join(root, 'guide/page.md'), join(root, 'guide/escape.md'));
 assert.equal((await call(root, ['docs', 'check'], ErrorOutput, '', 1)).error, 'UnsafePath');
});
