// 跨进程保证：进程终止与信号——真实editor worker被OS暂停后来源变化使在途结果失效，恢复后继续提供当前导航。
import { parseWritingPolicy, renderWritingPolicy } from '../../src/model/index.ts';
import { pollUntil } from '../support/support.ts';
import { assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, join, resolve, fileURLToPath, pathToFileURL, test, Effect, Schema, readProjectConfig, writeProjectConfig, Position, Range, Location, Response, Diagnostics, file, reference, source, stepLine, testText, codeText, scratch, entry, cli, consumer, Client, run } from '../support/editor-fixture.ts';
// @use-case docs/feature/local-sdlc/use-case/use-editor-service.md
// @name editor-disk-and-policy
test('packed editor C9/C17 rereads disk configuration, policy, deletion and rename without moving overlays', { timeout: 90000 }, () => run(async (c, root) => {
  c.open(file, source('new-step')); c.open('test/flow.ts', testText(reference));
  await c.diagnostic('test/flow.ts', 1);
  const policyPath = 'docs/writing.md';
  const policy = parseWritingPolicy(readFileSync(join(root, policyPath), 'utf8'));
  c.open(policyPath, renderWritingPolicy({ ...policy, bannedTerms: [{ term: 'buffer', use: 'document', why: 'Precise noun' }] }), 1, 'markdown');
  const count = c.diagnostics.length;
  c.change(file, source('new-step'), 2);
  assert.ok((await c.diagnostic(file, 2, count)).diagnostics.some(item => item.code === 'bannedTerm'));
  c.close(policyPath);
  const configPath = join(root, 'concord.config.ts'), config = readProjectConfig(root);
  await c.result('textDocument/hover', c.query('test/flow.ts', 1, 20));
  writeFileSync(join(root, '.git/concord/editor-job-gate'), 'armed');
  const pending = c.request('textDocument/hover', c.query('test/flow.ts', 1, 20));
  const paused = join(root, '.git/concord/editor-job-gate.paused');
  const worker = await pollUntil(async () => {
    if (!existsSync(paused)) return undefined;
    const pid = Schema.decodeUnknownSync(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0)))(readFileSync(paused, 'utf8'));
    const state = process.platform === 'linux' ? readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ')[0]!
      : execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return state.startsWith('T') ? pid : undefined;
  }, { timeoutMs: 12000, description: 'captured editor worker stopped by the OS' });
  try {
    writeProjectConfig(root, { ...config, sourceRoots: [] });
    // A config byte edit invalidates the captured disk identity, even if semantically unrelated.
    writeFileSync(configPath, readFileSync(configPath, 'utf8') + '\n');
  } finally { process.kill(worker, 'SIGCONT'); rmSync(paused); }
  assert.equal((await pending.response).error?.code, -32801);
  const current = await c.result('textDocument/hover', c.query('test/flow.ts', 1, 20)); assert.match(JSON.stringify(current), /new-step/u);
  const reconfigured = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/references', c.query(file, stepLine, 0, { includeDeclaration: false })));
  assert.ok(!reconfigured.some(item => item.uri === c.uri('src/flow.ts')));
  rmSync(join(root, file));
  c.send('workspace/didDeleteFiles', { files: [{ uri: c.uri(file) }] });
  c.change('test/flow.ts', testText(reference), 2);
  assert.ok((await c.diagnostic('test/flow.ts', 2)).diagnostics.some(item => item.code === 'EditorInputsIncomplete' && /MissingDiskDependency/u.test(item.message)));
  assert.match(JSON.stringify(await c.result('textDocument/hover', c.query('test/flow.ts', 1, 20))), /new-step/u);
  writeFileSync(join(root, file), source('new-step'));
  const renamed = 'docs/feature/sample/use-case/renamed.md'; renameSync(join(root, file), join(root, renamed));
  c.send('workspace/didRenameFiles', { files: [{ oldUri: c.uri(file), newUri: c.uri(renamed) }] });
  assert.equal((await c.request('textDocument/hover', c.query(file, stepLine)).response).error?.code, -32801);
  c.close(file);
  c.open(renamed, source('new-step'));
  c.change('test/flow.ts', testText(`${renamed}#new-step`), 3);
  const locations = Schema.decodeUnknownSync(Schema.Array(Location))(await c.result('textDocument/definition', c.query('test/flow.ts', 1, 20)));
  assert.equal(locations[0]?.uri, c.uri(renamed));
  const newFile = 'test/newly-saved.ts';
  const newText = `// @use-case ${renamed}#new-step\n// @name newly-saved\n`;
  c.open(newFile, newText); writeFileSync(join(root, newFile), newText);
  c.send('textDocument/didSave', { textDocument: { uri: c.uri(newFile) }, text: newText });
  await c.result('textDocument/hover', c.query(newFile, 0, 20));
  rmSync(join(root, newFile)); c.send('workspace/didDeleteFiles', { files: [{ uri: c.uri(newFile) }] });
  c.change(newFile, newText, 2);
  assert.ok((await c.diagnostic(newFile, 2)).diagnostics.some(item => item.code === 'EditorInputsIncomplete'));
  assert.match(JSON.stringify(await c.result('textDocument/hover', c.query(newFile, 0, 20))), /new-step/u);
}, true));
