import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';


import { Schema } from 'effect';
import { expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { runCli } from '../support/cli.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { fetchFresh, waitForWorkspaceProjection, writeProjectConfig } from '../support/support.ts';
import { initialize } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { openHawdb } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';

const cli=sourceCli();
const write=(root:string,path:string,source:string)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),source);};

// @use-case docs/feature/web-workbench/use-case/review-local-changes.md
test('packed view serves its frontend and API without credentials in an isolated Git consumer', async ({ page, workspace }) => {
 const root=workspace.privateRoot();
 execFileSync('git',['init','-q',root]);
 const repository=new LocalRepository(root,{initialize:true});
 try {initialize(repository);} finally {repository.close();}
 writeProjectConfig(root,{testRoots:['test','tests']});
 openHawdb(join(root,'.git/concord/cache.hawdb'),{readOnly:false,create:true},makeRuntimeEnvironment(process.cwd(),process.env)).close();
 write(root, 'implementation.ts', 'export const value = "original";\n');
 execFileSync('git', ['-C', root, 'add', "."]);
 execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
 write(root, 'implementation.ts', 'export const value = "staged";\n');
 execFileSync('git', ['-C', root, 'add', 'implementation.ts']);
 write(root, 'implementation.ts', 'export const value = "working";\n');
 const server=await workspace.privateServer({root,host:'127.0.0.1',port:0,cliView:true});
 try {
  const ready=Schema.decodeUnknownSync(Schema.Struct({operation:Schema.Literal('view'),root:Schema.String,address:Schema.String,host:Schema.String,port:Schema.Int,local:Schema.Array(Schema.String),network:Schema.Array(Schema.String)}),{onExcessProperty:'error'})(JSON.parse(server.startupOutput.split('\n')[0]!));
  const help = execFileSync(globalThis.process.execPath, [cli, 'view', '--help'], { encoding: 'utf8' });
  assert.doesNotMatch(help, /key|login|authenticated|密钥/iu);
  const base=ready.address.replace('localhost','127.0.0.1');
  assert.equal(ready.host,'127.0.0.1');
  assert.ok(ready.port > 0);
  assert.deepEqual(ready.local,[base]);
  assert.deepEqual(ready.network,[]);
  const shell=await fetchFresh(base+'feature/accounts');
  assert.equal(shell.status,200);
  const html=await shell.text();
  assert.match(html,/<div id="root"><\/div>/);
  const script=/src="([^"]+\.js)"/.exec(html)?.[1]; assert.ok(script);
  const asset=await fetchFresh(new URL(script,base)); assert.equal(asset.status,200);
  assert.match(asset.headers.get('content-type')??'',/javascript/);
  assert.ok((await asset.arrayBuffer()).byteLength > 0);
  const workspace = await waitForWorkspaceProjection(new URL(base).origin, { timeoutMs: 60_000 });
  assert.ok(workspace.snapshot.root === root);
  assert.equal(workspace.projection.current, false);
  assert.equal((await fetchFresh(base+'api/missing')).status,404);
  const checked=await runCli({argv:['--root',root,'--json','--fresh','check'],cwd:globalThis.process.cwd(),env:globalThis.process.env,stdin:'Contract body.\n',signal:AbortSignal.timeout(20000)});
  assert.equal(checked.exitCode,0,checked.stderr);
  assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ok:Schema.Boolean})))(checked.stdout).ok,true,'idle server must not lock out the CLI');
  await page.route('**/api/git', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'GitFailed', message: 'Git fixture unavailable' }) }));
  await page.goto(base);
  await expect(page).toHaveURL(new URL('git', base).href);
  await expect(page.getByRole('alert')).toContainText('Git fixture unavailable');
  await page.unroute('**/api/git');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'implementation.ts', exact: true })).toBeVisible();
  await expect(page.locator('[data-git-diff]')).toContainText('working');
  await page.getByRole('tab', { name: '已暂存', exact: true }).click();
  await expect(page.locator('[data-git-diff]')).toContainText('original');
  await expect(page.locator('[data-git-diff]')).not.toContainText('working');
  await page.reload();
  await expect(page.getByRole('tab', { name: '已暂存', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /文档/ }).click();
  await expect(page.getByRole('button', { name: 'implementation.ts', exact: true })).toHaveCount(0);
 } finally {await server.close();}
});

