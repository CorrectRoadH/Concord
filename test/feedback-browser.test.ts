import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { initialize, LocalRepository } from '../dist/storage.js';
import { createDocument, loadDocuments, renderDocument } from '../dist/documents.js';
import { mergeFeedbackCache } from '../dist/feedback-cache.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';
import type { FeedbackSource } from '../dist/feedback-schema.js';

// @concord-case browser-feedback-authoring-and-connection-conflict
// @concord-contract docs/feature/feedback/use-case/triage-feedback.md
test('feedback browser separates remote observations from local editing and protects connection drafts', async () => {
  const root=mkdtempSync(join(tmpdir(),'concord-feedback-browser-'));
  let server:ViewServerHandle|undefined;
  let browser:Browser|undefined;
  const previousCredential=process.env.CONCORD_BROWSER_MISSING_TOKEN;
  process.env.CONCORD_BROWSER_MISSING_TOKEN='';
  try {
    execFileSync('git',['init','-q',root]);
    const repo=new LocalRepository(root,{initialize:true});
    try {
      initialize(repo,false,{testRoots:[]});
      createDocument(repo,'feature',{id:'target',title:'Feedback target'});
      createDocument(repo,'issue',{id:'remote-observation',title:'Local title retained',body:'Local notes retained.'});
      const document=loadDocuments(repo).find(item=>item.metadata.id==='remote-observation');
      assert.ok(document && document.metadata.kind==='issue');
      const source:FeedbackSource={provider:'github',instance:'https://api.github.com',id:'123',url:'https://github.com/example/demo/issues/7',title:'Original remote title',body:'Original remote body',state:'open',updatedAt:'2026-09-13T00:00:00.000Z',connectionId:'fixture',importedAt:'2026-09-13T01:00:00.000Z'};
      writeFileSync(join(root,document.path),renderDocument({...document.metadata,source},document.body));
      const {connectionId: _connectionId,importedAt: _importedAt,...remote}=source;
      mergeFeedbackCache(repo,'fixture',[{...remote,title:'Updated remote title',body:'Updated remote body',state:'closed',updatedAt:'2026-09-14T00:00:00.000Z'}]);
    } finally {repo.close();}
    server=await startViewServer({root,host:'127.0.0.1',port:0});
    const executablePath=process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium')?'/run/current-system/sw/bin/chromium':undefined);
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}/feedback`);
    await expect(page.getByRole('heading',{name:'反馈',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'添加连接',exact:true}).click();
    await page.getByLabel('连接 ID',{exact:true}).fill('browser-github');
    await page.getByLabel('凭据环境变量',{exact:true}).fill('CONCORD_BROWSER_MISSING_TOKEN');
    await page.getByLabel('GitHub owner',{exact:true}).fill('example');
    await page.getByLabel('GitHub repository',{exact:true}).fill('demo');
    const configPath=join(root,'concord.json');
    const config=JSON.parse(readFileSync(configPath,'utf8'));
    config.runner.timeoutMs=54321;
    const external=`${JSON.stringify(config,null,2)}\n`;
    writeFileSync(configPath,external);
    await page.waitForResponse(response=>response.url().endsWith('/api/workspace')&&response.ok());
    await page.getByRole('button',{name:'添加',exact:true}).click();
    await expect(page.getByRole('dialog').locator('.form-error')).toBeVisible();
    assert.equal(readFileSync(configPath,'utf8'),external);
    await expect(page.getByLabel('连接 ID',{exact:true})).toHaveValue('browser-github');
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.getByRole('button',{name:'添加连接',exact:true}).click();
    await page.getByLabel('连接 ID',{exact:true}).fill('browser-github');
    await page.getByLabel('凭据环境变量',{exact:true}).fill('CONCORD_BROWSER_MISSING_TOKEN');
    await page.getByLabel('GitHub owner',{exact:true}).fill('example');
    await page.getByLabel('GitHub repository',{exact:true}).fill('demo');
    await page.getByRole('button',{name:'添加',exact:true}).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect.poll(()=>JSON.parse(readFileSync(configPath,'utf8')).feedbackConnections?.[0]?.id).toBe('browser-github');
    await page.getByRole('button',{name:'同步',exact:true}).click();
    await expect(page.locator('.connection-record .form-error')).toBeVisible();
    await page.getByRole('button',{name:'新建本地反馈',exact:true}).click();
    await page.getByLabel('本地反馈 ID',{exact:true}).fill('browser-local');
    await page.getByLabel('本地反馈标题',{exact:true}).fill('Browser local feedback');
    await page.getByLabel('本地反馈正文',{exact:true}).fill('Authored local feedback.');
    await page.getByRole('button',{name:'创建',exact:true}).click();
    await page.getByRole('link').filter({hasText:'Browser local feedback'}).click();
    await page.getByRole('button',{name:'关联 Feature',exact:true}).click();
    await expect.poll(()=>readFileSync(join(root,'docs/issues/browser-local.md'),'utf8')).toContain('docs/feature/target/README.md');
    const editor=page.locator('[contenteditable="true"]').first();
    await editor.fill('Edited through feedback workbench.');
    await expect.poll(()=>readFileSync(join(root,'docs/issues/browser-local.md'),'utf8')).toContain('Edited through feedback workbench.');
    await page.getByRole('link',{name:'返回反馈列表',exact:true}).click();
    await page.getByRole('link').filter({hasText:'Local title retained'}).click();
    await expect(page.getByText('Original remote body',{exact:true})).toBeVisible();
    // Both snapshots remain independently accessible; the current observation must not replace author prose.
    const cachedTab=page.getByRole('tab').filter({hasText:/缓存|最近|远端观察/});
    if(await cachedTab.count()) await cachedTab.first().click();
    await expect(page.getByText('Updated remote body',{exact:true})).toBeVisible();
    await expect(page.locator('[contenteditable="true"]').first()).toContainText('Local notes retained.');
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await server?.close();rmSync(root,{recursive:true,force:true});if(previousCredential===undefined)delete process.env.CONCORD_BROWSER_MISSING_TOKEN;else process.env.CONCORD_BROWSER_MISSING_TOKEN=previousCredential;}
});
