
import { assert, existsSync, renameSync, join, test, before, Effect, Schema, digest, Ack, ErrorOutput, CheckOutput, TraceOutput, call, readPage, savePage, consumer, write } from '../support/cli-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('packed CLI creates and resolves Unicode Use Cases and supporting pages', () => Effect.runPromise(Effect.promise(async () => {
 const root = consumer('unicode-names');
 (await call(root, ['new', 'feature', 'npc', '--title', 'NPC'], Ack));
 renameSync(join(root, 'docs/feature/npc'), join(root, 'docs/feature/角色目录'));
 const paths = Schema.Struct({ changedPaths: Schema.Array(Schema.String) });
 const useCase = ['new', 'use-case', '扩展NPC动作', '--feature', '角色目录', '--title', '扩展 NPC 动作'];
 const expectedPath = 'docs/feature/角色目录/use-case/扩展NPC动作.md';
 assert.deepEqual((await call(root, ['--dry-run', ...useCase], paths)).changedPaths, [expectedPath]);
 assert.equal(existsSync(join(root, expectedPath)), false);
 (await call(root, useCase, Ack));
 write(root, 'docs/feature/角色目录/architecture/README.md', '# NPC 内部机制\n\n- [认知与执行](认知与执行.md)\n- [常识与上下文](常识与上下文.md)\n');
 for (const page of ['认知与执行', '常识与上下文']) {
   const pagePath = `docs/feature/角色目录/architecture/${page}.md`;
   write(root, pagePath, `# ${page}\n`);
   const before = readPage(root, pagePath);
   (await savePage(root, pagePath, `# ${page}\n\n中文正文。\n`, before.digest));
   assert.match(readPage(root, pagePath).body, /中文正文/u);
 }
 const shown = (await call(root, ['show', '扩展NPC动作'], Schema.Struct({ document: Schema.Struct({ path: Schema.String }) })));
 assert.equal(shown.document.path, expectedPath);
 write(root, 'test/unicode.test.ts', `// @use-case ${expectedPath}\n// @name 中文用例\n`);
 const trace = (await call(root, ['trace', 'show', expectedPath], TraceOutput));
 assert.equal(trace.tests.length, 1);
 (await call(root, ['new', 'use-case', 'internal-id', '--feature', '角色目录', '--title', '内部身份与文件名独立'], Ack));
 const namedPath = 'docs/feature/角色目录/use-case/中文文件名.md';
 renameSync(join(root, 'docs/feature/角色目录/use-case/internal-id.md'), join(root, namedPath));
 assert.equal((await call(root, ['show', '中文文件名'], Schema.Struct({ document: Schema.Struct({ path: Schema.String }) }))).document.path, namedPath);
 write(root, 'test/named.test.ts', `// @use-case ${namedPath}\n`);
 assert.equal((await call(root, ['check'], CheckOutput)).ok, true);
 assert.equal((await call(root, ['trace', 'check'], CheckOutput)).ok, true);
 assert.equal((await call(root, ['trace', 'show', namedPath], TraceOutput)).tests.length, 1);
 (await call(root, ['trace', 'gaps'], Ack));
 renameSync(join(root, namedPath), join(root, 'docs/feature/角色目录/中文文件名.md'));
 assert.equal((await call(root, ['check'], CheckOutput, '', 1)).ok, false);
 assert.equal((await savePage(root, '../越界.md', '# No\n', 'sha256:unknown', 1)).error, 'FileNotFound');
 assert.equal((await call(root, ['new', 'use-case', '坏/名称', '--feature', '角色目录', '--title', '坏名称'], ErrorOutput, '', 1)).error, 'InvalidData');
})));
