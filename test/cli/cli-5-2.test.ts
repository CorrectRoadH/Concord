import { createRequire, packageBin, createConsumer, sourceConcord, prepareSourceConsumer, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, TemplatesOutput, scratch, cli, call, callString, readPage, savePage, consumer, write } from '../support/cli-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('packed templates work outside a project and fail clearly when their inventory is damaged', () => Effect.runPromise(Effect.sync(() => {
 const installation = mkdtempSync(join(scratch, 'private-templates-'));
 writeFileSync(join(installation, 'package.json'), JSON.stringify({ private: true }));
 prepareSourceConsumer(installation, sourceConcord(), [], { private: true });
 const cli = packageBin(join(installation, 'node_modules/concord-sdlc'));
 const result = spawnSync(process.execPath, [cli, 'template', 'list', '--json'], { cwd: scratch, encoding: 'utf8' });
 assert.equal(result.status, 0, result.stderr);
 const templates = Schema.decodeUnknownSync(Schema.fromJsonString(TemplatesOutput))(result.stdout);
 assert.ok(templates.templates.some(item => item.name === 'engineering'));
 for (const name of ['api', 'format', 'ui', 'performance', 'data-model']) {
  assert.ok(templates.templates.some(item => item.name === name));
  const page = spawnSync(process.execPath, [cli, 'template', 'show', name, '--title', 'Accounts'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(page.status, 0, page.stderr);
  assert.match(page.stdout, /# Accounts/u);
 }
 const shown = spawnSync(process.execPath, [cli, 'template', 'show', 'feature', '--title', 'Accounts'], { cwd: scratch, encoding: 'utf8' });
 assert.equal(shown.status, 0, shown.stderr);
 assert.match(shown.stdout, /# Accounts/);
 const template = join(installation, 'node_modules/concord-sdlc/templates/feature.md');
 const original = readFileSync(template, 'utf8');
 try {
  rmSync(template);
  const broken = spawnSync(process.execPath, [cli, 'template', 'list', '--json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(broken.status, 1);
  assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(broken.stderr).error, 'TemplateInventoryInvalid');
 } finally { writeFileSync(template, original); }
})));


// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('packed CLI creates and resolves Unicode Use Cases and supporting pages', () => Effect.runPromise(Effect.sync(() => {
 const root = consumer('unicode-names');
 call(root, ['new', 'feature', 'npc', '--title', 'NPC'], Ack);
 renameSync(join(root, 'docs/feature/npc'), join(root, 'docs/feature/角色目录'));
 const paths = Schema.Struct({ changedPaths: Schema.Array(Schema.String) });
 const useCase = ['new', 'use-case', '扩展NPC动作', '--feature', '角色目录', '--title', '扩展 NPC 动作'];
 const expectedPath = 'docs/feature/角色目录/use-case/扩展NPC动作.md';
 assert.deepEqual(call(root, ['--dry-run', ...useCase], paths).changedPaths, [expectedPath]);
 assert.equal(existsSync(join(root, expectedPath)), false);
 call(root, useCase, Ack);
 write(root, 'docs/feature/角色目录/architecture/README.md', '# NPC 内部机制\n\n- [认知与执行](认知与执行.md)\n- [常识与上下文](常识与上下文.md)\n');
 for (const page of ['认知与执行', '常识与上下文']) {
   const pagePath = `docs/feature/角色目录/architecture/${page}.md`;
   write(root, pagePath, `# ${page}\n`);
   const before = readPage(root, pagePath);
   savePage(root, pagePath, `# ${page}\n\n中文正文。\n`, before.digest);
   assert.match(readPage(root, pagePath).body, /中文正文/u);
 }
 const shown = call(root, ['show', '扩展NPC动作'], Schema.Struct({ document: Schema.Struct({ path: Schema.String }) }));
 assert.equal(shown.document.path, expectedPath);
 write(root, 'test/unicode.test.ts', `// @use-case ${expectedPath}\n// @name 中文用例\n`);
 const trace = call(root, ['trace', 'show', expectedPath], TraceOutput);
 assert.equal(trace.tests.length, 1);
 call(root, ['new', 'use-case', 'internal-id', '--feature', '角色目录', '--title', '内部身份与文件名独立'], Ack);
 const namedPath = 'docs/feature/角色目录/use-case/中文文件名.md';
 renameSync(join(root, 'docs/feature/角色目录/use-case/internal-id.md'), join(root, namedPath));
 assert.equal(call(root, ['show', '中文文件名'], Schema.Struct({ document: Schema.Struct({ path: Schema.String }) })).document.path, namedPath);
 write(root, 'test/named.test.ts', `// @use-case ${namedPath}\n`);
 assert.equal(call(root, ['check'], CheckOutput).ok, true);
 assert.equal(call(root, ['trace', 'check'], CheckOutput).ok, true);
 assert.equal(call(root, ['trace', 'show', namedPath], TraceOutput).tests.length, 1);
 call(root, ['trace', 'gaps'], Ack);
 renameSync(join(root, namedPath), join(root, 'docs/feature/角色目录/中文文件名.md'));
 assert.equal(call(root, ['check'], CheckOutput, '', 1).ok, false);
 assert.equal(savePage(root, '../越界.md', '# No\n', 'sha256:unknown', 1).error, 'FileNotFound');
 assert.equal(call(root, ['new', 'use-case', '坏/名称', '--feature', '角色目录', '--title', '坏名称'], ErrorOutput, '', 1).error, 'InvalidData');
})));
