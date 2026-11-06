// 跨进程保证：进程终止与信号——真实CLI收到SIGTERM后终止Git子进程并删除隔离Git临时目录
import { assert, execFileSync, spawn, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, readdirSync, join, test, once, Effect, scratch, cli, write } from '../support/cli-fixture.ts';


import { makeRuntimeEnvironment as makeParserRuntime } from '../../src/base/environment/index.ts';
const parserRuntime = makeParserRuntime(process.cwd(), process.env);


// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('PR export SIGTERM releases its Git process and temporary repository', async () => {
 const root=join(scratch,'pr-export-signal');mkdirSync(root);
 const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 write(root,'docs/taste.md',readFileSync(new URL('../../templates/taste.md',import.meta.url),'utf8'));
 write(root,'empty.md','');write(root,'type.txt','ordinary content\n');write(root,'executable.sh','echo hello\n');write(root,'old.md','# Kept\n');
 git('add',".");git('commit','-qm','base');const base=git('rev-parse','HEAD');
 rmSync(join(root,'empty.md'));rmSync(join(root,'type.txt'));symlinkSync('/etc/passwd',join(root,'type.txt'));
 git('mv','old.md','空 白\n名.md');git('add',".");git('update-index','--chmod=+x','executable.sh');git('update-index','--add','--cacheinfo',`160000,${base},submodule`);
 git('commit','-qm','object types');const head=git('rev-parse','HEAD');git('replace',head,base);git('config','diff.ignoreSubmodules','all');
 git('replace','-d',head);
 if(process.platform!=='win32'){
  const shim=join(scratch,'cancel-git');mkdirSync(shim);const temporary=join(scratch,'cancel-tmp');mkdirSync(temporary);const pidFile=join(scratch,'cancel-git.pid');
  const realGit=execFileSync('sh',['-c','command -v git'],{encoding:'utf8'}).trim();
  const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
  writeFileSync(join(shim,'git'),`#!/bin/sh\ncase " $* " in *" diff "*) echo $$ > "$CONCORD_TEST_GIT_PID"; sleep 60 & wait;; *) exec ${quote(realGit)} "$@";; esac\n`,{mode:0o755});
  execFileSync(process.execPath,['-e',''],{env:{...process.env,TMPDIR:temporary}});
  const loaderEntries=readdirSync(temporary).sort();
  const child=spawn(process.execPath,[cli,'--root',root,'--json','view','export','--base',base,'--head',head,'--out',join(scratch,'cancelled-out')],{env:{...process.env,PATH:shim+':'+process.env.PATH,TMPDIR:temporary,CONCORD_TEST_GIT_PID:pidFile},stdio:'ignore'});
  const exited=once(child,'exit');
  try{
   const deadline=Date.now()+15000;while(!existsSync(pidFile)&&Date.now()<deadline)await Effect.runPromise(Effect.sleep('20 millis'));
   assert.ok(existsSync(pidFile),'export reached the scoped Git comparison');const pid=Number(readFileSync(pidFile,'utf8').trim());
   child.kill('SIGTERM');await exited;assert.throws(()=>process.kill(pid,0));assert.deepEqual(readdirSync(temporary).sort(),loaderEntries,'interruption releases the temporary Git repository');
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
 }
});
