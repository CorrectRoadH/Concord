// 跨进程保证：运行环境——私有安装模板被删除时真实入口拒绝损坏inventory而不复用已加载资源
import { privateSourceInstallation } from '../support/private-source.ts';
import { assert, spawnSync, mkdtempSync, writeFileSync, rmSync, readFileSync, join, test, Effect, Schema, ErrorOutput, TemplatesOutput, scratch, cli } from '../support/cli-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('packed templates work outside a project and fail clearly when their inventory is damaged', () => Effect.runPromise(Effect.promise(async () => {
 const installation = mkdtempSync(join(scratch, 'private-templates-'));
 const cli = privateSourceInstallation(installation);
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
 const template = join(installation, 'templates/feature.md');
 const original = readFileSync(template, 'utf8');
 try {
  rmSync(template);
  const broken = spawnSync(process.execPath, [cli, 'template', 'list', '--json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(broken.status, 1);
  assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(broken.stderr).error, 'TemplateInventoryInvalid');
 } finally { writeFileSync(template, original); }
})));


