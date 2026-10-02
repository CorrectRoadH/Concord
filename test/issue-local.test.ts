import { packConcord, installConcord } from './installed-package.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { before, after } from 'node:test';
import { Effect, Schema } from 'effect';
import { LocalRepository } from '../dist/storage.js';
import { loadDocuments, parseDocumentRecord, renderDocument } from '../dist/documents.js';

const packedRoot = mkdtempSync(join(tmpdir(), 'concord-issue-packed-'));
let cli = resolve('dist/entry.js');
before(() => Effect.runPromise(Effect.sync(() => {
  const packed = packConcord(packedRoot);
  const install = join(packedRoot,'install'); mkdirSync(install); writeFileSync(join(install,'package.json'), JSON.stringify({ private: true }));
  installConcord(install, packed);
  cli = join(install,'node_modules/concord-sdlc/dist/entry.js');
})));
after(() => Effect.runPromise(Effect.sync(() => rmSync(packedRoot, { recursive: true, force: true }))));
function call(root: string, args: string[], status = 0, input = '') {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { cwd: root, input, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, status, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout.trim() || result.stderr) as { error?: string; details?: { command: string; replacement: string } };
}
// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('local Issue lifecycle uses the public CLI without a repository profile', t => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-issue-local-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  call(root, ['init']);
  assert.equal(existsSync(join(root, 'concord.repository.json')), false);
  call(root, ['feature', 'create', 'flow', '--title', 'Flow']);
  call(root, ['memory', 'add', 'note', '--title', 'Note', '--kind', 'note']);
  call(root, ['memory', 'add', 'decision', '--title', 'Decision', '--kind', 'decision']);
  call(root, ['memory', 'add', 'problem', '--title', 'Problem', '--kind', 'problem']);
  call(root, ['issue', 'create', 'canonical', '--title', 'Canonical']);
  call(root, ['issue', 'create', 'observation', '--title', 'Observation']);
  mkdirSync(join(root,'test'), { recursive: true }); writeFileSync(join(root,'test/incomplete.test.ts'),'// @feature docs/feature/missing/README.md\n');
  const target = 'docs/feature/flow/README.md';
  call(root, ['issue', 'adopt', 'observation', '--to', target]);
  const adopted = readFileSync(join(root,'docs/issues/observation.md'),'utf8');
  for (const args of [['--kind','invalid','--evidence','Invalid'],['--kind','duplicate','--canonical','docs/issues/canonical.md'],['--kind','declined','--memory','memory/decision.md']]) {
    assert.equal(call(root,['issue','close','observation',...args],1).error,'InvalidState');
    assert.equal(readFileSync(join(root,'docs/issues/observation.md'),'utf8'),adopted);
  }
  assert.equal(call(root,['issue','adopt','observation','--to',`${target}#missing`],1).error,'AnchorNotFound');
  call(root,['issue','adopt','observation','--to',`${target}#flow`]);

  assert.equal(call(root, ['issue', 'retire', 'observation', '--from', target], 1).error, 'IssueRetireRequiresCommit');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  call(root, ['issue', 'retire', 'observation', '--from', target]);
  call(root, ['issue','retire','observation','--from',`${target}#flow`]);
  const record = () => parseDocumentRecord('docs/issues/observation.md', readFileSync(join(root, 'docs/issues/observation.md'), 'utf8'))!;
  const retired = record().metadata; assert.equal(retired.kind === 'issue' && retired.adoptions.history[0]?.commit, execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  for (const kind of ['investigation', 'root-cause', 'decision', 'delivery']) call(root, ['issue', 'link', 'observation', '--memory', 'memory/note.md', '--kind', kind]);
  assert.equal(call(root, ['issue', 'link', 'observation', '--memory', 'memory/note.md'], 1).error, 'DuplicateLink');
  const closures = [ ['--reason', 'Reviewed'], ['--kind', 'invalid', '--evidence', 'Observation disproven'], ['--kind', 'duplicate', '--canonical', 'docs/issues/canonical.md'], ['--kind', 'declined', '--memory', 'memory/decision.md'], ['--kind', 'external-fixed', '--dependency', 'library', '--version', '2', '--proof', 'release'] ];
  for (const args of closures) {
    call(root, ['issue', 'close', 'observation', ...args]);
    assert.equal(call(root, ['issue', 'adopt', 'observation', '--to', target], 1).error, 'InvalidIssueState');
    assert.equal(call(root, ['issue', 'link', 'observation', '--memory', 'memory/decision.md'], 1).error, 'InvalidIssueState');
    call(root, ['issue', 'reopen', 'observation', '--reason', 'More investigation']);
  }
  call(root, ['issue', 'link', 'observation', '--memory', 'memory/problem.md']);
  const capturedFixture = new LocalRepository(root);
  try {
    const problem = loadDocuments(capturedFixture).find(document => document.metadata.id === 'problem')!;
    if (problem.metadata.kind !== 'memory') throw new Error('Expected Memory');
    capturedFixture.publish('fixture', [{ path: problem.path, before: readFileSync(join(root,problem.path),'utf8'), after: renderDocument({ ...problem.metadata, state: 'captured' },problem.body) }]);
  } finally { capturedFixture.close(); }
  for (const state of ['captured','open']) {
    if (state === 'open') call(root,['memory','activate','problem','--reason','Investigation started']);
    for (const kind of ['fixed','delivered','duplicate','declined','invalid','external-fixed','closed']) {
      const args = kind === 'fixed' || kind === 'delivered' ? ['--memory','memory/problem.md','--proof','evidence', ...(kind === 'delivered' ? ['--target',target] : [])] : kind === 'duplicate' ? ['--canonical','docs/issues/canonical.md'] : kind === 'declined' ? ['--memory','memory/decision.md'] : kind === 'invalid' ? ['--evidence','evidence'] : kind === 'external-fixed' ? ['--dependency','library','--version','2','--proof','release'] : ['--reason','Reviewed'];
      assert.equal(call(root, ['issue','close','observation','--kind',kind,...args], 1).error, 'OpenProblem');
    }
  }
  // Historical Memory owner fixtures retain their existing schema; closure uses the real validator.
  const repo = new LocalRepository(root);
  try {
    const problem = loadDocuments(repo).find(document => document.metadata.id === 'problem')!;
    assert.equal(problem.metadata.kind, 'memory');
    if (problem.metadata.kind !== 'memory') throw new Error('Expected Memory');
    const resolution = { kind: 'fixed' as const, evidenceLevel: 'command' as const, reason: 'Historical fixed resolution', at: '2026-09-14T00:00:00.000Z', epoch: 0, red: 'historical-red', green: 'historical-green', selectedCaseId: 'historical-case' };
    repo.publish('fixture', [{ path: problem.path, before: readFileSync(join(root, problem.path), 'utf8'), after: renderDocument({ ...problem.metadata, state: 'resolved', resolution }, problem.body) }]);
  } finally { repo.close(); }
  call(root, ['issue','close','observation','--kind','fixed','--memory','memory/problem.md','--proof','Historical proof']);
  call(root, ['issue','reopen','observation','--reason','Check delivery']);
  call(root, ['issue','close','observation','--kind','delivered','--memory','memory/decision.md','--target',target,'--proof','Delivered contract']);
  call(root, ['issue','reopen','observation','--reason','Continue']);
  call(root,['action','--input','-'],0,JSON.stringify({action:'issue.adopt',id:'observation',to:target}));
  call(root,['action','--input','-'],0,JSON.stringify({action:'issue.retire',id:'observation',from:target}));
  call(root,['action','--input','-'],0,JSON.stringify({action:'issue.link',id:'observation',kind:'decision',memory:'memory/decision.md'}));
  call(root,['action','--input','-'],0,JSON.stringify({action:'issue.close',id:'observation',kind:'external-fixed',dependency:'library',version:'3',proof:['Release']}));
  call(root,['action','--input','-'],0,JSON.stringify({action:'issue.reopen',id:'observation',reason:'More observations'}));
  call(root,['action','--input','-'],0,JSON.stringify({action:'issue.close',id:'observation',reason:'Reviewed'}));
  call(root,['action','--input','-'],0,JSON.stringify({action:'issue.reopen',id:'observation',reason:'More observations'}));
  const reopened = record().metadata; assert.equal(reopened.kind === 'issue' && reopened.closure, undefined);
  assert.equal(reopened.kind === 'issue' && reopened.history.at(-1)?.reason, 'More observations');
  const before = readFileSync(join(root, 'docs/issues/observation.md'), 'utf8');
  assert.equal(call(root,['action','--input','-'],1,JSON.stringify({action:'feedback.link',id:'observation',feature:target})).error,'CommandRetired');
  for (const name of ['link','adopt','retire','close','reopen']) {
    const result = spawnSync(process.execPath,[cli,'repo','feedback',name,'observation','--obsolete','ignored','--kind','not-a-kind','--json'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 1, result.stderr);
    const error = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String, details: Schema.Struct({ command: Schema.String, replacement: Schema.String }) })), { onExcessProperty: 'ignore' })(result.stderr);
    assert.equal(error.error,'CommandRetired'); assert.equal(error.details.command,`concord repo feedback ${name}`);
  }
  for (const name of ['create','link','close']) {
    const error = call(root, ['feedback', name, 'observation', '--obsolete', 'ignored', '--feature', target], 1);
    assert.equal(error.error, 'CommandRetired'); assert.equal(error.details?.command, `concord feedback ${name}`);
  }
  assert.equal(readFileSync(join(root, 'docs/issues/observation.md'), 'utf8'), before);
})));

// @use-case docs/feature/feedback/use-case/manage-local-observations.md
test('historical Issue files have consistent public check judgments', t => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(),'concord-issue-historical-')); t.after(() => rmSync(root,{recursive:true,force:true}));
  execFileSync('git',['init','-q',root]); call(root,['init']);
  mkdirSync(join(root,'e2e'));
  writeFileSync(join(root,'concord.repository.json'),JSON.stringify({format:'concord.repository/v2',suites:[{id:'suite',root:'e2e'}],historyPath:'test-history.ts',policy:'concord.native-reliability/v1'}));
  execFileSync('git',['-C',root,'add','.']); execFileSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture']);
  const base = {format:'concord.document/v1' as const,kind:'issue' as const,id:'historical',title:'Historical Issue',createdAt:'2026-09-14T00:00:00.000Z',state:'closed' as const,memoryRelations:[],adoptions:{current:[],history:[]},history:[]};
  mkdirSync(join(root,'docs/issues'), { recursive: true });
  const owner = join(root,'docs/issues/historical.md');
  for (const invalid of [false,true]) {
    const closure = invalid ? {kind:'duplicate' as const,canonical:'docs/issues/historical.md'} : {kind:'closed' as const,reason:'Recorded conclusion'};
    writeFileSync(owner,renderDocument({...base,closure},'# Historical observation\n'));
    const basic = spawnSync(process.execPath,[cli,'--root',root,'check','--json'],{cwd:root,encoding:'utf8',timeout:30_000});
    const repository = spawnSync(process.execPath,[cli,'repo','feedback','check','--json'],{cwd:root,encoding:'utf8',timeout:30_000});
    assert.equal(basic.status,invalid?1:0,basic.stderr+basic.stdout);
    assert.equal(repository.status,invalid?1:0,repository.stderr+repository.stdout);
    if (invalid) { assert.match(basic.stdout,/ReferenceCycle/); assert.match(repository.stdout,/cycle/); }
  }
})));
