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
import { projectConfigPath, readProjectConfig, writeProjectConfig } from './support.js';

// @use-case docs/feature/feedback/use-case/triage-feedback.md
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
    server=await startViewServer({root,host:'127.0.0.1',port:0,...(process.env.CONCORD_TEST_WEB_ROOT?{webRoot:process.env.CONCORD_TEST_WEB_ROOT}:{})});
    const executablePath=process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium')?'/run/current-system/sw/bin/chromium':undefined);
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}/feedback`);
    await expect(page.getByRole('heading',{name:'反馈',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'添加连接',exact:true})).toHaveCount(0);
    await page.getByRole('link',{name:'管理反馈来源'}).click();
    await expect(page).toHaveURL(/\/settings\?tab=feedback$/);
    await page.getByRole('button',{name:'添加连接',exact:true}).click();
    await page.getByLabel('连接 ID',{exact:true}).fill('browser-github');
    await page.getByLabel('凭据环境变量',{exact:true}).fill('CONCORD_BROWSER_MISSING_TOKEN');
    await page.getByLabel('GitHub owner',{exact:true}).fill('example');
    await page.getByLabel('GitHub repository',{exact:true}).fill('demo');
    const configPath=join(root,projectConfigPath(root));
    const config=readProjectConfig(root);
    writeProjectConfig(root,{...config,runner:{...config.runner,timeoutMs:54321}});
    const external=readFileSync(configPath,'utf8');
    await page.getByRole('button',{name:'添加',exact:true}).click();
    await expect(page.getByRole('tabpanel',{name:'反馈来源'}).getByRole('status').filter({hasText:'自动保存失败'})).toBeVisible();
    assert.equal(readFileSync(configPath,'utf8'),external);
    await expect(page.getByRole('tabpanel',{name:'反馈来源'}).locator('strong').filter({hasText:'example/demo'})).toBeVisible();
    await page.getByRole('button',{name:'重新载入'}).click();
    await page.getByRole('button',{name:'丢弃并载入'}).click();
    await page.getByRole('button',{name:'添加连接',exact:true}).click();
    await page.getByLabel('连接 ID',{exact:true}).fill('browser-github');
    await page.getByLabel('凭据环境变量',{exact:true}).fill('CONCORD_BROWSER_MISSING_TOKEN');
    await page.getByLabel('GitHub owner',{exact:true}).fill('example');
    await page.getByLabel('GitHub repository',{exact:true}).fill('demo');
    await page.getByRole('button',{name:'添加',exact:true}).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect.poll(()=>readProjectConfig(root).feedbackConnections?.[0]?.id).toBe('browser-github');
    await page.goto(`http://127.0.0.1:${server.port}/feedback`);
    await page.getByRole('button',{name:'同步',exact:true}).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.getByRole('textbox',{name:'搜索反馈'}).fill('no-matching-feedback');
    await expect(page.getByText('没有匹配的反馈')).toBeVisible();
    await expect(page.getByRole('combobox',{name:'按来源筛选'})).toBeVisible();
    await page.getByRole('textbox',{name:'搜索反馈'}).clear();
    await page.getByRole('button',{name:'新建本地反馈',exact:true}).click();
    await page.getByLabel('本地反馈 ID',{exact:true}).fill('browser-local');
    await page.getByLabel('本地反馈标题',{exact:true}).fill('Browser local feedback');
    await page.getByLabel('本地反馈正文',{exact:true}).fill('Authored local feedback.');
    await page.getByRole('button',{name:'创建',exact:true}).click();
    await page.getByRole('link').filter({hasText:'Browser local feedback'}).click();
    await expect(page.getByRole('button',{name:'关联 Feature',exact:true})).toHaveCount(0);
    await page.getByRole('tab',{name:'来源与关联',exact:true}).click();
    await page.getByRole('button',{name:'关联 Feature',exact:true}).click();
    await expect(page.getByRole('button',{name:'删除本地草稿'})).toHaveCount(0);
    await expect.poll(()=>readFileSync(join(root,'docs/issues/browser-local.md'),'utf8')).toContain('docs/feature/target/README.md');
    await page.getByRole('tab',{name:'正文',exact:true}).click();
    const editor=page.locator('[contenteditable="true"]').first();
    await editor.fill('Edited through feedback workbench.');
    await expect.poll(()=>readFileSync(join(root,'docs/issues/browser-local.md'),'utf8')).toContain('Edited through feedback workbench.');
    await page.getByRole('link',{name:'返回反馈列表',exact:true}).click();
    await page.getByRole('link').filter({hasText:'Local title retained'}).click();
    const localEditor=page.locator('[contenteditable="true"]').first();
    await expect(localEditor).toContainText('Local notes retained.');
    await localEditor.fill('Local notes retained. Saved before opening sources.');
    await page.getByRole('tab',{name:'来源与关联',exact:true}).click();
    await expect(page.getByRole('button',{name:'删除本地草稿'})).toHaveCount(0);
    await expect.poll(()=>readFileSync(join(root,'docs/issues/remote-observation.md'),'utf8')).toContain('Saved before opening sources.');
    await expect(page.getByText('Original remote body',{exact:true})).toBeVisible();
    // Both snapshots remain independently accessible; the current observation must not replace author prose.
    const cachedTab=page.getByRole('tab').filter({hasText:/缓存|最近|远端观察/});
    if(await cachedTab.count()) await cachedTab.first().click();
    await expect(page.getByText('Updated remote body',{exact:true})).toBeVisible();
    await expect(page.getByRole('tab',{name:'来源与关联',exact:true})).toHaveAttribute('data-state','active');
    await page.getByRole('tab',{name:'正文',exact:true}).click();
    await expect(page.getByText('Original remote body',{exact:true})).toHaveCount(0);
    await expect(page.locator('[contenteditable="true"]').first()).toContainText('Local notes retained.');
    await page.goto(`http://127.0.0.1:${server.port}/settings?tab=feedback`);
    await page.getByRole('button',{name:'移除连接 browser-github'}).click();
    await expect.poll(()=>readProjectConfig(root).feedbackConnections?.length).toBe(0);
    await page.goto(`http://127.0.0.1:${server.port}/feedback`);
    await expect(page.getByRole('link').filter({hasText:'Local title retained'})).toBeVisible();
    await expect(page.getByText('尚未配置远端来源')).toBeVisible();
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await server?.close();rmSync(root,{recursive:true,force:true});if(previousCredential===undefined)delete process.env.CONCORD_BROWSER_MISSING_TOKEN;else process.env.CONCORD_BROWSER_MISSING_TOKEN=previousCredential;}
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('empty feedback keeps creation and settings visible without filters', async () => {
  const root=mkdtempSync(join(tmpdir(),'concord-empty-feedback-browser-'));
  let server:ViewServerHandle|undefined;
  let browser:Browser|undefined;
  try {
    execFileSync('git',['init','-q',root]);
    const repo=new LocalRepository(root,{initialize:true});
    try { initialize(repo,false,{testRoots:[]}); } finally { repo.close(); }
    server=await startViewServer({root,host:'127.0.0.1',port:0,...(process.env.CONCORD_TEST_WEB_ROOT?{webRoot:process.env.CONCORD_TEST_WEB_ROOT}:{})});
    const executablePath=process.env.CONCORD_BROWSER_PATH ?? (existsSync('/run/current-system/sw/bin/chromium')?'/run/current-system/sw/bin/chromium':undefined);
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/feedback`);
    await expect(page.getByRole('button',{name:'新建本地反馈'})).toBeVisible();
    await expect(page.getByRole('link',{name:'管理反馈来源'})).toBeVisible();
    await expect(page.getByRole('textbox',{name:'搜索反馈'})).toHaveCount(0);
    await expect(page.getByRole('combobox',{name:'按来源筛选'})).toHaveCount(0);
    await expect(page.getByText('还没有反馈')).toBeVisible();
  } finally { await browser?.close(); await server?.close(); rmSync(root,{recursive:true,force:true}); }
});
