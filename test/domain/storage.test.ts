import { initialize } from '../support/operations.ts';
import { recoverLocalState } from '../../src/app/index.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { syncBuiltinMocks } from '../support/builtin-mocks.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { LocalRepository, runApplication } from "../support/repository.ts";

import { renderTypeScriptConfig } from "../../src/base/workspace/index.ts";
import { digest } from "../../src/model/index.ts";
import { projectConfigPath, readProjectConfig } from '../support/support.ts';
const fixture = () => { const root=mkdtempSync(join(tmpdir(),'concord-storage-'));execFileSync('git',['init','-q',root]);return root; };

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
// @spec docs/feature/portable-coordination/statechart.md#RecoveredFilesMatchOneImage
test('project outlines preview without writes and recovery completes a fully installed prepared publication', () => Effect.runPromise(Effect.tryPromise(async () => {
 const root = fixture(); let repo: LocalRepository | undefined;
 try {
  repo = (await LocalRepository.open(root, { initialize: true, dryRun: true }));
  const preview = (await initialize(repo, true));
  for (const path of ['docs/concepts.md', 'docs/architecture.md']) {
   assert.ok(preview.changedPaths.includes(path));
   assert.equal(existsSync(join(root, path)), false);
  }
  repo.close();
  repo = (await LocalRepository.open(root, { initialize: true })); (await initialize(repo, false, { testRoots: [] }));
  (await repo.publish('project-markdown', [{ path: 'docs/arbitrary.md', before: null, after: '# Project page\n' }]));
  assert.equal(repo.read('docs/arbitrary.md'), '# Project page\n');
  (await assert.rejects(async () => (await repo!.publish('out-of-scope', [{ path: 'arbitrary.md', before: null, after: '# No\n' }])), { code: 'InvalidChange' }));
  const frozen = { kind: 'documents', configPath: repo.configSnapshot.path, configSource: repo.configSnapshot.source, configDigest: repo.configSnapshot.digest };
  const changes = ['docs/concord.md', 'docs/architecture.md'].map(path => {
   const before = repo!.read(path)!; const after = '# Interrupted outline\n';
   return { path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 420 };
  });
  repo.close(); repo = undefined;
  for (const change of changes) writeFileSync(join(root, change.path), change.after);
  const journal = join(root, '.git/concord/journal.json');
  const temp = `${journal}.123.00000000-0000-4000-8000-000000000000.tmp`;
  writeFileSync(journal, JSON.stringify({ format: 'concord.journal', root, privateDir: join(root, '.git/concord'), operation: 'outlines', phase: 'prepared', directories: [], scope: frozen, changes }));
  writeFileSync(temp, 'interrupted committed journal');
  repo = (await LocalRepository.open(root, { recover: true }));
  const result = await repo.recover();
  assert.equal(result.journalStatus, 'completed');
  for (const change of changes) assert.equal(repo.read(change.path), change.after);
  assert.equal(existsSync(journal), false);
  assert.equal(existsSync(temp), false);
 } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));
// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md
test('dry-run creates no private state; init conflicts and symlinks preserve existing content',()=>Effect.runPromise(Effect.tryPromise(async ()=>{
 const root=fixture();try {
  let repo=(await LocalRepository.open(root,{initialize:true,dryRun:true}));assert.equal((await initialize(repo,true)).dryRun,true);repo.close();assert.equal(existsSync(join(root,'concord.config.ts')),false);assert.equal(existsSync(join(root,'.git/concord')),false);
  repo=(await LocalRepository.open(root,{initialize:true}));(await assert.rejects(async ()=>(await initialize(repo,false,{testRoots:['node_modules']})),{code:'InvalidSourcePath'}));repo.close();assert.equal(existsSync(join(root,'concord.config.ts')),false);
  mkdirSync(join(root,'memory'));writeFileSync(join(root,'memory/README.md'),'existing');repo=(await LocalRepository.open(root,{initialize:true}));(await assert.rejects(async ()=>(await initialize(repo)),{code:'InitializationConflict'}));repo.close();assert.equal(existsSync(join(root,'concord.config.ts')),false);assert.equal(readFileSync(join(root,'memory/README.md'),'utf8'),'existing');
  rmSync(join(root,'memory/README.md'));repo=(await LocalRepository.open(root,{initialize:true}));(await initialize(repo, false, { testRoots: [] }));const parallel=(await LocalRepository.open(root));parallel.close();(await repo.snapshot(async ()=>(await assert.rejects(async ()=>(await LocalRepository.open(root)),{code:'RepositoryBusy'}))));assert.throws(()=>repo.absolute('../escape'),{code:'UnsafePath'});symlinkSync('/tmp',join(root,'linked'));assert.throws(()=>repo.absolute('linked/x'),{code:'UnsafePath'});repo.close();
 } finally {rmSync(root,{recursive:true,force:true});}
})));
// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md
test('interrupted multi-file publication rolls back, and recovery preserves external edits',()=>Effect.runPromise(Effect.tryPromise(async ()=>{
 const root=fixture();let repo: LocalRepository | undefined;try {
  repo=(await LocalRepository.open(root,{initialize:true}));(await initialize(repo, false, { testRoots: [] }));repo.close();
  mkdirSync(join(root,'docs/design/blocked'));writeFileSync(join(root,'memory/a.md'),'before');writeFileSync(join(root,'docs/design/blocked/b.md'),'before-b');
  const publishingRepo=(await LocalRepository.open(root));repo=publishingRepo;chmodSync(join(root,'docs/design/blocked'),0o555);
  (await assert.rejects(async ()=>(await publishingRepo.publish('failure',[{path:'memory/a.md',before:'before',after:'after'},{path:'docs/design/blocked/b.md',before:'before-b',after:'after-b'}])),{code:'RecoveryRequired'}));publishingRepo.close();chmodSync(join(root,'docs/design/blocked'),0o755);
  assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'after');(await assert.rejects(async ()=>(await LocalRepository.open(root)),{code:'RecoveryRequired'}));
  writeFileSync(join(root,'memory/a.md'),'external');
  const discardedRepo=(await LocalRepository.open(root,{recover:true}));const discarded=(await discardedRepo.recover());discardedRepo.close();
  assert.equal(discarded.status,'discarded');assert.deepEqual(discarded.warnings,['memory/a.md']);assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'external');
  writeFileSync(join(root,'memory/a.md'),'after');const recoveryJournalPath=join(root,'.git','concord','journal.json');
  const confSource=readFileSync(join(root,'concord.config.ts'),'utf8');
  writeFileSync(recoveryJournalPath,JSON.stringify({format:'concord.journal',root,privateDir:join(root,'.git','concord'),operation:'failure',phase:'prepared',directories:[],scope:{kind:'documents',configPath:'concord.config.ts',configSource:confSource,configDigest:digest(confSource)},changes:[{path:'memory/a.md',before:'before',after:'after',beforeDigest:digest('before'),afterDigest:digest('after'),mode:420},{path:'docs/design/blocked/b.md',before:'before-b',after:'after-b',beforeDigest:digest('before-b'),afterDigest:digest('after-b'),mode:420}]})+'\n');
  const recoveryRepo=(await LocalRepository.open(root,{recover:true}));repo=recoveryRepo;assert.equal((await recoveryRepo.recover()).status,'rolled-back');assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'before');recoveryRepo.close();
 } finally {repo?.close();chmodSync(join(root,'docs/design/blocked'),0o755);rmSync(root,{recursive:true,force:true});}
})));

// @spec docs/feature/portable-coordination/statechart.md#RecoveryPreservesExternalEdit
test('recovery preserves an external edit made while it stages a restore', async () => {
  const root = fixture();
  let repo: LocalRepository | undefined;
  const sync = fs.fsyncSync;
  try {
    repo = await LocalRepository.open(root, { initialize: true });
    await initialize(repo, false, { testRoots: [] });
    const config = repo.configSnapshot;
    const privateDir = repo.privateDir;
    repo.close();
    const changes = ['a.md', 'b.md'].map(name => ({ path: `memory/${name}`, before: 'before', after: 'after', beforeDigest: digest('before'), afterDigest: digest('after'), mode: 0o644 }));
    const journal = join(privateDir, 'journal.json');
    const target = join(root, 'memory/a.md');
    writeFileSync(target, 'after');
    writeFileSync(join(root, 'memory/b.md'), 'before');
    writeFileSync(journal, JSON.stringify({ format: 'concord.journal', root, privateDir, operation: 'interrupted', phase: 'prepared', directories: [], changes,
      scope: { kind: 'documents', configPath: config.path, configSource: config.source, configDigest: config.digest },
    }));
    repo = await LocalRepository.open(root, { recover: true });
    let edited = false;
    fs.fsyncSync = fd => {
      sync(fd);
      if (edited || !fs.readdirSync(join(root, 'memory')).some(name => name.startsWith('a.md.') && name.endsWith('.tmp'))) return;
      edited = true;
      const editorTemp = join(root, 'memory/.editor-save');
      writeFileSync(editorTemp, 'external edit');
      fs.renameSync(editorTemp, target);
    };
    syncBuiltinMocks();

    const result = await repo.recover();
    assert.equal(edited, true);
    assert.equal(readFileSync(target, 'utf8'), 'external edit');
    assert.equal(result.journalStatus, 'discarded');
    assert.deepEqual(result.warnings, ['memory/a.md']);
    assert.equal(existsSync(journal), false);
  } finally {
    fs.fsyncSync = sync;
    syncBuiltinMocks();
    repo?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md
test('unified journal recovers interrupted init and preflights every target',async () => {
 const root=fixture();let repo: LocalRepository | undefined;try {
  const config=renderTypeScriptConfig({testRoots:[],sourceRoots:['src']});
  const guide='# guide\n'; const journalPath=join(root,'.git','concord','journal.json');mkdirSync(join(root,'.git','concord'),{recursive:true});mkdirSync(join(root,'docs'),{recursive:true});writeFileSync(join(root,'docs/concord.md'),guide);
  writeFileSync(journalPath,JSON.stringify({format:'concord.journal',root,privateDir:join(root,'.git','concord'),operation:'init',phase:'prepared',directories:['docs'],scope:{kind:'documents',configPath:'concord.config.ts',configSource:'',configDigest:digest('')},changes:[
   {path:'concord.config.ts',before:null,after:config,beforeDigest:null,afterDigest:digest(config),mode:420},
   {path:'docs/concord.md',before:null,after:guide,beforeDigest:null,afterDigest:digest(guide),mode:420},
  ]})+'\n');
  const recovered = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({status: Schema.Literal('rolled-back'), journalStatus: Schema.Literal('rolled-back')})))(JSON.stringify(await runApplication(recoverLocalState(root))));
  assert.equal(recovered.status,'rolled-back');assert.equal(existsSync(join(root,'concord.config.ts')),false);assert.equal(existsSync(join(root,'docs/concord.md')),false);
  const initial=(await LocalRepository.open(root,{initialize:true}));(await initialize(initial, false, { testRoots: ['test', 'tests'] }));initial.close();
  writeFileSync(join(root,'memory/a.md'),'before-a');writeFileSync(join(root,'memory/b.md'),'before-b');const marker=readFileSync(join(root,projectConfigPath(root)),'utf8');
  const batch={format:'concord.journal',root,privateDir:join(root,'.git','concord'),operation:'batch',phase:'prepared',directories:[],scope:{kind:'documents',configPath:'concord.config.ts',configSource:marker,configDigest:digest(marker)},changes:[
   {path:'memory/a.md',before:'before-a',after:'after-a',beforeDigest:digest('before-a'),afterDigest:digest('after-a'),mode:420},
   {path:'memory/b.md',before:'before-b',after:'after-b',beforeDigest:digest('before-b'),afterDigest:digest('after-b'),mode:420},
  ]};
  writeFileSync(join(root,'memory/a.md'),'after-a');writeFileSync(join(root,'memory/b.md'),'external');writeFileSync(journalPath,JSON.stringify(batch)+'\n');
  const externalRepo=(await LocalRepository.open(root,{recover:true}));const externalResult=(await externalRepo.recover());externalRepo.close();
  assert.equal(externalResult.status,'discarded');assert.deepEqual(externalResult.warnings,['memory/b.md']);assert.equal(readFileSync(join(root,'memory/a.md'),'utf8'),'after-a');assert.equal(existsSync(journalPath),false);
 } finally {repo?.close();rmSync(root,{recursive:true,force:true});}
});

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md
test('recovery discards an undecodable journal and keeps the current workspace files', async () => {
  const root = fixture();
  try {
    const initial = await LocalRepository.open(root, { initialize: true });
    try { await initialize(initial, false, { testRoots: [] }); }
    finally { initial.close(); }
    const journal = join(root, '.git/concord/journal.json');
    const target = join(root, 'memory/a.md');
    writeFileSync(target, '# Current state\n');

    for (const source of ['{"format":"concord.journal/v2","changes":[{"path":"memory/a.md","before":null}]}', '{ truncated']) {
      writeFileSync(journal, source, { mode: 0o600 });
      const repo = await LocalRepository.open(root, { recover: true });
      try {
        const result = await repo.recover();
        assert.equal(result.status, 'discarded');
        assert.equal(result.journalStatus, 'discarded');
        assert.deepEqual(result.changedPaths, []);
        assert.ok(result.warnings.some(warning => warning.includes('journal.json')));
      } finally { repo.close(); }
      assert.equal(existsSync(journal), false);
      assert.equal(readFileSync(target, 'utf8'), '# Current state\n');
    }

    const result = await runApplication(recoverLocalState(root));
    assert.equal(result.journalStatus, 'clean');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md
test('recovery preserves unsafe entries at the journal path', async () => {
  const root = fixture();
  try {
    const initial = await LocalRepository.open(root, { initialize: true });
    try { await initialize(initial, false, { testRoots: [] }); }
    finally { initial.close(); }
    const journal = join(root, '.git/concord/journal.json');
    const target = join(root, 'memory/a.md');
    writeFileSync(target, 'undecodable', { mode: 0o600 });
    symlinkSync(target, journal);

    await assert.rejects(runApplication(recoverLocalState(root)), { code: 'UnsafePath' });
    assert.equal(fs.readlinkSync(journal), target);
    assert.equal(readFileSync(target, 'utf8'), 'undecodable');
    rmSync(journal);

    mkdirSync(journal);
    await assert.rejects(runApplication(recoverLocalState(root)));
    assert.equal(fs.lstatSync(journal).isDirectory(), true);
    rmSync(journal, { recursive: true });

    writeFileSync(journal, 'undecodable', { mode: 0o666 });
    chmodSync(journal, 0o666);
    await assert.rejects(runApplication(recoverLocalState(root)));
    assert.equal(readFileSync(journal, 'utf8'), 'undecodable');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
