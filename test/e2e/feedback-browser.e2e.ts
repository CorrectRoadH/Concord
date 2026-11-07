import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { browserActionReceipt, browserDocumentProjection } from '../support/browser-save.ts';
import assert from 'node:assert/strict';
import { initialize, createDocument } from '../support/operations.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from './fixtures.ts';
import { expect } from '@playwright/test';
import { LocalRepository } from '../support/repository.ts';
import { loadDocuments } from '../../src/domain/documents/index.ts';
import { renderDocument, type FeedbackSource } from '../../src/model/index.ts';
import { mergeFeedbackCache, openHawdb, cacheDatabasePath } from '../../src/base/cache/index.ts';
import { type ViewServerHandle } from './server.ts';
import { projectConfigPath, readProjectConfig, waitForWorkspaceProjection, writeProjectConfig } from '../support/support.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('feedback browser separates remote observations from local editing and protects connection drafts', async ({ page, workspace }) => {
  const root=workspace.privateRoot();
  let server:ViewServerHandle|undefined;

  const previousCredential=process.env.CONCORD_BROWSER_MISSING_TOKEN;
  process.env.CONCORD_BROWSER_MISSING_TOKEN='';
  try {
    execFileSync('git',['init','-q',root]);
    const repo=(await LocalRepository.open(root,{initialize:true}));
    try {
      (await initialize(repo,false,{testRoots:[]}));
      openHawdb(cacheDatabasePath(repo.privateDir), { readOnly: false, create: true }, nativeRuntime).close();
      (await createDocument(repo,'feature',{id:'target',title:'Feedback target'}));
      (await createDocument(repo,'issue',{id:'remote-observation',title:'Local title retained',body:'Local notes retained.'}));
      const document=loadDocuments(repo).find(item=>item.metadata.id==='remote-observation');
      assert.ok(document && document.metadata.kind==='issue');
      const source:FeedbackSource={provider:'github',instance:'https://api.github.com',id:'123',url:'https://github.com/example/demo/issues/7',title:'Original remote title',body:'Original remote body',state:'open',updatedAt:'2026-09-13T00:00:00.000Z',connectionId:'fixture',importedAt:'2026-09-13T01:00:00.000Z'};
      writeFileSync(join(root,document.path),renderDocument({...document.metadata,source},document.body));
      const {connectionId: _connectionId,importedAt: _importedAt,...remote}=source;
      mergeFeedbackCache(repo,'fixture',[{...remote,title:'Updated remote title',body:'Updated remote body',state:'closed',updatedAt:'2026-09-14T00:00:00.000Z'}]);
    } finally {repo.close();}
    server=await workspace.privateServer({root,host:'127.0.0.1',port:0});
    await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);

    await page.setViewportSize({width:1440,height:1000});
    const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}/feedback`);
    await expect(page.getByRole('complementary',{name:'反馈 侧栏'})).toBeVisible();
    await expect(page.getByRole('button',{name:'添加连接',exact:true})).toHaveCount(0);
    await page.getByRole('link',{name:'管理反馈来源'}).click();
    await expect(page).toHaveURL(/\/settings\?tab=feedback$/);
    await page.getByRole('button',{name:'添加连接',exact:true}).click();
    await page.getByLabel('连接 ID',{exact:true}).fill('browser-github');
    await page.getByLabel('凭据环境变量',{exact:true}).fill('CONCORD_BROWSER_MISSING_TOKEN');
    await page.getByLabel('GitHub owner',{exact:true}).fill('example');
    await page.getByLabel('GitHub repository',{exact:true}).fill('demo');
    const configPath=join(root,projectConfigPath(root));
    const config=(await readProjectConfig(root));
    writeProjectConfig(root,{...config,sourceRoots:['external-source']});
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
    const connectionAdded = browserActionReceipt(page, 'config.set', input => JSON.stringify(input.config).includes('browser-github'));
    await page.getByRole('button',{name:'添加',exact:true}).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await connectionAdded;
    await expect.poll(async ()=>(await readProjectConfig(root)).feedbackConnections?.[0]?.id).toBe('browser-github');
    await expect(page.getByRole('tabpanel',{name:'反馈来源'}).getByRole('status')).toHaveText('已自动保存');
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
    const featureLinked = browserActionReceipt(page, 'issue.link', input => {
      if (input.id !== 'docs/issues/browser-local.md') return false;
      assert.equal(input.role, 'spec');
      assert.equal(input.memory, 'docs/feature/target/README.md');
      assert.equal('target' in input, false);
      return true;
    });
    await page.getByRole('button',{name:'关联 Feature',exact:true}).click();
    await expect(page.getByRole('button',{name:'删除本地草稿'})).toHaveCount(0);
    await featureLinked;
    await expect.poll(()=>readFileSync(join(root,'docs/issues/browser-local.md'),'utf8')).toContain('docs/feature/target/README.md');
    assert.match(readFileSync(join(root,'docs/issues/browser-local.md'),'utf8'), /role: spec/u);
    await expect(page.locator('.feedback-feature-card code')).toHaveText('docs/feature/target/README.md');
    await expect(page.getByRole('button',{name:'关联 Feature',exact:true})).toHaveCount(0);
    await page.getByRole('tab',{name:'正文',exact:true}).click();
    const editor=page.getByRole('textbox',{name:'Markdown 原文',exact:true});
    const editedFeedback = browserActionReceipt(page, 'document.set', input => input.path === 'docs/issues/browser-local.md' && String(input.body).includes('Edited through feedback workbench.'));
    await editor.fill(readFileSync(join(root,'docs/issues/browser-local.md'),'utf8').replace('Authored local feedback.', 'Edited through feedback workbench.'));
    await editedFeedback;
    await expect.poll(()=>readFileSync(join(root,'docs/issues/browser-local.md'),'utf8')).toContain('Edited through feedback workbench.');
    const feedbackNavigation = page.getByRole('complementary', { name: '反馈 侧栏' });
    await expect(feedbackNavigation.getByRole('link').filter({hasText:'Browser local feedback'})).toHaveAttribute('aria-current', 'page');
    const navigatedFeedback = browserActionReceipt(page, 'document.set', input => input.path === 'docs/issues/browser-local.md' && String(input.body).includes('Saved before selecting another feedback.'));
    await editor.fill(readFileSync(join(root,'docs/issues/browser-local.md'),'utf8').replace('Edited through feedback workbench.', 'Saved before selecting another feedback.'));
    await feedbackNavigation.getByRole('link').filter({hasText:'Local title retained'}).click();
    await navigatedFeedback;
    await expect.poll(()=>readFileSync(join(root,'docs/issues/browser-local.md'),'utf8')).toContain('Saved before selecting another feedback.');
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'内容导航',exact:true}).click();
    const feedbackDrawer = page.getByRole('dialog', { name: '反馈 导航' });
    await feedbackDrawer.getByRole('textbox', {name:'搜索反馈'}).fill('Browser local');
    await feedbackDrawer.getByRole('link').filter({hasText:'Browser local feedback'}).click();
    await expect(feedbackDrawer).toHaveCount(0);
    await page.getByRole('button',{name:'内容导航',exact:true}).click();
    await expect(feedbackDrawer.getByRole('textbox', {name:'搜索反馈'})).toHaveValue('Browser local');
    await feedbackDrawer.getByRole('textbox', {name:'搜索反馈'}).clear();
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('link',{name:'返回反馈列表',exact:true}).click();
    await page.getByRole('link').filter({hasText:'Local title retained'}).click();
    const localEditor=page.getByRole('textbox',{name:'Markdown 原文',exact:true});
    await expect(localEditor).toHaveValue(/Local notes retained\./u);
    const remoteBody = readFileSync(join(root,'docs/issues/remote-observation.md'),'utf8').replace('Local notes retained.', 'Local notes retained. Saved before opening sources.');
    const remoteSaved = browserActionReceipt(page, 'document.set', input => input.path === 'docs/issues/remote-observation.md' && input.body === remoteBody);
    const remoteProjection = browserDocumentProjection(page, 'docs/issues/remote-observation.md', remoteBody);
    const sourceRead = page.waitForResponse(async response => {
      if (response.request().method() !== 'GET' || new URL(response.url()).pathname !== '/api/file' || new URL(response.url()).searchParams.get('path') !== 'docs/issues/remote-observation.md') return false;
      if (await page.getByRole('tab', { name: '来源与关联', exact: true }).getAttribute('data-state') !== 'active') return false;
      assert.equal(response.status(), 200, await response.text());
      const file = await response.json() as { value?: { body?: string } };
      return file.value?.body === remoteBody;
    });
    await localEditor.fill(remoteBody);
    await page.getByRole('tab',{name:'来源与关联',exact:true}).click();
    await expect(page.getByRole('button',{name:'删除本地草稿'})).toHaveCount(0);
    await remoteSaved;
    await remoteProjection;
    assert.equal(await (await sourceRead).finished(), null);
    await expect.poll(()=>readFileSync(join(root,'docs/issues/remote-observation.md'),'utf8')).toContain('Saved before opening sources.');
    await expect(page.getByText('Original remote body',{exact:true})).toBeVisible();
    // Both snapshots remain independently accessible; the current observation must not replace author prose.
    await expect(page.getByText('Updated remote body',{exact:true})).toBeVisible();
    await expect(page.getByRole('tab',{name:'来源与关联',exact:true})).toHaveAttribute('data-state','active');
    await page.getByRole('tab',{name:'正文',exact:true}).click();
    await expect(page.getByText('Original remote body',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('textbox',{name:'Markdown 原文',exact:true})).toHaveValue(/Local notes retained\./u);
    await page.goto(`http://127.0.0.1:${server.port}/settings?tab=feedback`);
    const connectionRemoved = browserActionReceipt(page, 'config.set', input => !JSON.stringify(input.config).includes('browser-github'));
    await page.getByRole('button',{name:'移除连接 browser-github'}).click();
    await connectionRemoved;
    await expect.poll(async ()=>(await readProjectConfig(root)).feedbackConnections?.length).toBe(0);
    await expect(page.getByRole('status').filter({ hasText: '已自动保存' })).toBeVisible();
    await page.goto(`http://127.0.0.1:${server.port}/feedback`);
    await expect(page.getByRole('link').filter({hasText:'Local title retained'})).toBeVisible();
    await expect(page.getByText('尚未配置远端来源')).toBeVisible();
    assert.deepEqual(errors,[]);
  } finally {await server?.close();rmSync(root,{recursive:true,force:true});if(previousCredential===undefined)delete process.env.CONCORD_BROWSER_MISSING_TOKEN;else process.env.CONCORD_BROWSER_MISSING_TOKEN=previousCredential;}
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('empty feedback keeps creation and settings visible without filters', async ({ page, workspace }) => {
  const root=workspace.root;
  let server:ViewServerHandle|undefined;

  server=await workspace.ready();

  await page.goto(`http://127.0.0.1:${server.port}/feedback`);
  await expect(page.getByRole('button',{name:'新建本地反馈'})).toBeVisible();
  await expect(page.getByRole('link',{name:'管理反馈来源'})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'搜索反馈'})).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'按来源筛选'})).toHaveCount(0);
  await expect(page.getByText('还没有反馈')).toBeVisible();

});
