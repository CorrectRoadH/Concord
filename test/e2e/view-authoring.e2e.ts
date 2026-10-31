import { addPage, createDocument, initialize } from '../support/operations.js';
import { Deferred, Effect } from 'effect';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import { test } from './fixtures.js';
import { act } from './journey.js';
import { expect } from '@playwright/test';


import { LocalRepository } from "../support/repository.js";

import { type ViewServerHandle } from './server.js';
import { startViewServer } from './server.js';
import { parseWorkspaceProjection, pollUntil, projectConfigPath, readProjectConfig, waitForWorkspaceProjection, writeProjectConfig } from '../support/support.js';// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('real browser creates a Feature, edits Markdown, preserves conflicts and opens Git changes', async ({ page }) => {
  const root=mkdtempSync(join(tmpdir(),'concord-browser-'));
  let server: ViewServerHandle|undefined;

  try {
    execFileSync('git',['init','-q',root]);
    const repo=new LocalRepository(root,{initialize:true});
    try {
      initialize(repo,false,{testRoots:['test'],sourceRoots:['src'],runner:{kind:'command',argv:[process.execPath,'--test','{file}'],timeoutMs:15000,sourceFiles:[]}});
      createDocument(repo,'engineering',{id:'build',title:'Build workflow'});
      const engineeringPath=join(root,'docs/engineering/build/README.md');
      writeFileSync(engineeringPath,`${readFileSync(engineeringPath,'utf8')}\n\`\`\`mermaid\nflowchart LR\n  Source --> Result\n\`\`\`\n`);
      addPage(repo,'engineering','build','architecture');
      writeFileSync(join(root,'docs/engineering/build/architecture.md'),'# Architecture\n\n## Source\n');
      createDocument(repo,'roadmap',{id:'future',title:'Future direction',pages:['architecture']});
      createDocument(repo,'design',{id:'options',title:'Design options',alternatives:['first','second'],pages:['architecture']});
      createDocument(repo,'research',{id:'study',title:'Research study',observedAt:'2026-09-14',sources:['Local observations']});
    } finally {repo.close();}
    mkdirSync(join(root,'src'));
    writeFileSync(join(root,'src/demo.ts'),'// @concord-code\n// @concord-implements docs/engineering/build/architecture.md#source\nexport function demo() { return 1; }\n');
    server=await startViewServer({root,host:'127.0.0.1',port:0});
    await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);

    await page.setViewportSize({width:1440,height:1000});
    const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}/features`);
    await expect(page.getByRole('heading',{name:'Feature',exact:true})).toBeVisible();
    assert.equal(await page.getByRole('link',{name:'Feature',exact:true}).evaluate(element=>getComputedStyle(element).display),'flex','sidebar must forward shadcn classes to its links');
    assert.equal(await page.locator('[data-slot="sidebar"]').getByRole('link',{name:'Use Case',exact:true}).count(),0);
    const sidebar=page.locator('[data-slot="sidebar"]');
    const navigation=page.getByRole('navigation',{name:'内容导航',exact:true});
    for (const [category,title,section] of [['Engineering','Build workflow','engineering'],['Roadmap','Future direction','roadmap'],['Design','Design options','design'],['Research','Research study','research']] as const) {
      await sidebar.getByRole('link',{name:category,exact:true}).click();
      const list=navigation.getByRole('list',{name:`${category} 列表`,exact:true});
      await expect(sidebar.getByRole('link',{name:title,exact:true})).toHaveCount(0);
      await list.getByRole('link',{name:title,exact:true}).click();
      await expect(page).toHaveURL(new RegExp(`/${section}/`));
      await expect(list.getByRole('link',{name:title,exact:true})).toHaveAttribute('aria-current','page');
      if (category === 'Roadmap') {
        await expect(page.getByRole('tab', { name: '术语', exact: true })).toBeVisible();
        await expect(page.getByRole('tab', { name: '实现', exact: true })).toHaveCount(0);
        await expect(page.getByRole('tab', { name: '测试', exact: true })).toHaveCount(0);
      }
      if (category === 'Engineering') {
        const diagram=page.getByLabel('Mermaid 图表预览').locator('svg');
        await expect(diagram).toBeVisible();
        const initialDiagram=await diagram.evaluate(element=>element.outerHTML);
        await page.locator('.theme-toggle').click();
        await expect.poll(()=>diagram.evaluate(element=>element.outerHTML)).not.toBe(initialDiagram);
        await page.getByRole('tab',{name:'实现',exact:true}).click();
        await expect(page.getByRole('tab',{name:'实现',exact:true})).toHaveAttribute('data-state','active');
        await expect(page.getByRole('tab',{name:'测试',exact:true})).toHaveCount(0);
        await expect(page.getByText('docs/engineering/build/architecture.md#source',{exact:true})).toBeVisible();
        const implementationRecord=page.locator('.implementation-record').first();
        const columns=await implementationRecord.evaluate(element=>Array.from(element.children).map(child=>child.getBoundingClientRect()));
        assert.ok(columns[1]!.left > columns[0]!.right,'desktop implementation details should occupy the right column');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),'desktop implementation must not overflow');
        await page.getByRole('button',{name:/src\/demo\.ts/}).click();
        await expect(page.getByRole('dialog')).toContainText('export function demo()');
        await page.getByRole('button',{name:'Close',exact:true}).click();
        await page.setViewportSize({width:900,height:1000});
        const narrowBounds=await implementationRecord.evaluate(element=>Array.from(element.children).map(child=>({top:child.getBoundingClientRect().top,bottom:child.getBoundingClientRect().bottom})));
        assert.ok(narrowBounds[1]!.top > narrowBounds[0]!.bottom,'narrow content should stack implementation details');
        assert.ok(await implementationRecord.evaluate(element=>element.scrollWidth <= element.clientWidth),'narrow content implementation must not overflow horizontally');
        await page.setViewportSize({width:480,height:1000});
        assert.ok(await implementationRecord.evaluate(element=>element.scrollWidth <= element.clientWidth),'mobile implementation must not overflow horizontally');
        await page.setViewportSize({width:1440,height:1000});
        await page.getByRole('button',{name:'添加关联',exact:true}).click();
        await expect(page.getByLabel('代码声明 ID',{exact:true})).toHaveCount(0);
        await page.getByLabel('实现 Spec 引用',{exact:true}).fill('docs/engineering/build/architecture.md#source');
        await page.getByRole('button',{name:'生成',exact:true}).click();
        await expect(page.getByText(/@concord-implements docs\/engineering\/build\/architecture\.md#source/).first()).toBeVisible();
        await page.getByRole('tab',{name:'正文',exact:true}).click();
      }
      if (category !== 'Research') {
        const tree=page.getByTestId('document-file-tree');
        if (category === 'Design') {
          assert.ok(await page.getByTestId('document-file-preview').evaluate(element=>element.getBoundingClientRect().width >= 600),'Design body stays at least 600px wide at 1440px');
        }
        await expect(tree).toBeVisible();
        const disclosure=tree.getByRole('button',{name:'文件',exact:true});
        if (await disclosure.isVisible()) await disclosure.click();
        if (category === 'Design') {
          await expect(tree.getByRole('button',{name:'展开 plans',exact:true})).toHaveAttribute('aria-expanded','false');
          await tree.getByRole('button',{name:'展开 plans',exact:true}).click();
          await expect(tree.getByRole('button',{name:'展开 plans/second',exact:true})).toHaveAttribute('aria-expanded','false');
          await tree.getByRole('button',{name:'展开 plans/first',exact:true}).click();
          await expect(tree.getByRole('button',{name:'plans/first/README.md',exact:true})).toHaveCount(0);
          await tree.getByRole('button',{name:'plans/first',exact:true}).click();
          await expect(tree.getByRole('button',{name:'plans/first',exact:true,includeHidden:true})).toHaveAttribute('data-active','true');
          if (await disclosure.isVisible()) {
            await expect(disclosure).toHaveAttribute('aria-expanded','false');
            await disclosure.click();
          }
        }
        const supportingPage=page.getByTestId('document-file-tree').getByRole('button',{name:category === 'Design' ? 'plans/first/architecture.md' : 'architecture.md',exact:true});
        await supportingPage.click();
        await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
      }
      await expect(list.getByRole('link',{name:title,exact:true})).toBeVisible();
    }
    await sidebar.getByRole('link',{name:'Feature',exact:true}).click();
    await page.getByRole('button',{name:'新建 Feature',exact:true}).click();
    await page.getByLabel('Feature ID',{exact:true}).fill('browser-feature');
    await page.getByLabel('Feature 标题',{exact:true}).fill('Browser authoring');
    await page.getByRole('checkbox',{name:'Architecture',exact:true}).check();
    await page.getByRole('checkbox',{name:'Library',exact:true}).check();
    await page.getByLabel('初始正文',{exact:true}).fill('# Browser authoring\n\nOriginal paragraph.\n');
    await page.getByRole('button',{name:'创建',exact:true}).click();
    assert.equal(existsSync(join(root,'docs/feature/browser-feature/cli.md')),false);
    await page.getByRole('link').filter({hasText:'Browser authoring'}).first().click();
    await page.getByRole('button',{name:'新建 Feature',exact:true}).click();
    await page.getByLabel('Feature ID',{exact:true}).fill('alternate-feature');
    await page.getByLabel('Feature 标题',{exact:true}).fill('Alternate Feature');
    await page.getByRole('button',{name:'创建',exact:true}).click();
    const featureList=navigation.getByRole('list',{name:'Feature 列表',exact:true});
    await featureList.getByRole('link',{name:'Alternate Feature',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Alternate Feature',exact:true}).first()).toBeVisible();
    await expect(featureList.getByRole('link',{name:'Browser authoring',exact:true})).toBeVisible();
    await featureList.getByRole('link',{name:'Browser authoring',exact:true}).click();
    await expect(featureList.getByRole('link',{name:'Alternate Feature',exact:true})).toBeVisible();
    await expect(page.locator('.page .card-grid')).toHaveCount(0);
    await navigation.getByLabel('筛选 Feature',{exact:true}).fill('browser-feature');
    await expect(featureList.getByRole('link',{name:'Alternate Feature',exact:true})).toHaveCount(0);
    await navigation.getByLabel('筛选 Feature',{exact:true}).fill('');
    const editor=page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('Original paragraph.');
    await expect(page.locator('.page .page-header')).toHaveCount(0);
    await expect(page.locator('.editor-shell__bar .eyebrow')).toHaveCount(0);
    const path=join(root,'docs/feature/browser-feature/README.md');
    const original=readFileSync(path,'utf8');
    await expect(page.getByRole('button',{name:'保存',exact:true})).toHaveCount(0);
    assert.equal(readFileSync(path,'utf8'),original,'loading must not normalize the file');
    let busySaveResponses = 0;
    await page.route('**/api/action', async route => {
      const action = route.request().postDataJSON() as { action?: string };
      if (action.action === 'document.set' && busySaveResponses++ === 0) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'RepositoryBusy', message: 'shared Trace lease is busy' }) });
      } else await route.continue();
    });
    await editor.locator('p').first().fill('Browser edited paragraph.');
    await expect(page.locator('.editor-shell')).toHaveAttribute('data-dirty', 'true');
    await page.getByRole('tab',{name:'术语',exact:true}).click();
    await expect(page.getByRole('tab',{name:'术语',exact:true})).toHaveAttribute('data-state', 'active', { timeout: 20000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('tab',{name:'正文',exact:true}).click();
    await expect(editor).toContainText('Browser edited paragraph.');
    await expect.poll(()=>readFileSync(path,'utf8')).toContain('Browser edited paragraph.');
    assert.ok(busySaveResponses >= 2, 'a transient lease conflict retries the save');
    await page.unroute('**/api/action');
    await page.getByRole('tab',{name:'元数据',exact:true}).click();
    await page.getByLabel('文档标题',{exact:true}).fill('Browser authoring renamed');
    await expect(featureList.getByRole('link',{name:'Browser authoring renamed',exact:true})).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('文档标题',{exact:true}).fill('Browser authoring');
    await expect(featureList.getByRole('link',{name:'Browser authoring',exact:true})).toBeVisible({ timeout: 15_000 });
    await page.getByRole('tab',{name:'正文',exact:true}).click();
    await expect(editor).toBeVisible();
    let releaseSave: (() => void) | undefined;
    const holdSave = new Promise<void>(resolve => { releaseSave = resolve; });
    let writes = 0;
    await page.route('**/api/action', async route => {
      const action = route.request().postDataJSON() as { action?: string; path?: string };
      if (action.action === 'document.set' && action.path === 'docs/feature/browser-feature/README.md') {
        writes++;
        if (writes === 1) await holdSave;
      }
      await route.continue();
    });
    await editor.locator('p').first().fill('Browser edited paragraph. First revision.');
    await expect.poll(() => writes).toBe(1);
    await editor.locator('p').first().fill('Browser edited paragraph. Latest revision.');
    assert.equal(writes, 1, 'later input waits behind the in-flight save');
    releaseSave?.();
    await expect.poll(()=>readFileSync(path,'utf8')).toContain('Latest revision.');
    assert.equal(writes, 2);
    // The next conflict starts after the preceding save has committed its readback baseline.
    await expect(page.locator('.editor-shell')).toHaveAttribute('data-dirty', 'false');
    await page.unroute('**/api/action');
    const disk=readFileSync(path,'utf8').replace('Browser edited paragraph.','External editor wins.');
    // Write after the save request is sent, before the real server checks its CAS.
    // The external editor is the boundary; the actual conflict detection still runs.
    await page.route('**/api/action', async route => {
      const action = route.request().postDataJSON() as { action?: string; path?: string };
      if (action.action === 'document.set' && action.path === 'docs/feature/browser-feature/README.md') writeFileSync(path,disk);
      await route.continue();
    });
    await editor.locator('p').first().fill('Unsaved browser draft.');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Unsaved browser draft.');
    assert.equal(readFileSync(path,'utf8'),disk,'conflict must preserve the external edit');
    await page.unroute('**/api/action');
    await page.getByRole('button',{name:'丢弃草稿并载入',exact:true}).click();
    await expect(page.getByRole('button',{name:'新建 Use Case',exact:true})).toHaveCount(0);
    await page.getByRole('tab',{name:'Use Cases',exact:true}).click();
    await page.getByRole('button',{name:'新建 Use Case',exact:true}).click();
    await page.getByLabel('Use Case ID',{exact:true}).fill('browser-flow');
    await page.getByLabel('Use Case 标题',{exact:true}).fill('Nested browser flow');
    await page.getByRole('button',{name:'创建',exact:true}).click();
    const nestedCase=page.locator('.feature-use-cases').getByRole('link').filter({hasText:'Nested browser flow'});
    await expect(nestedCase).toBeVisible();
    await expect(sidebar.getByRole('link',{name:'Nested browser flow',exact:true})).toHaveCount(0);
    const primaryBounds=await sidebar.boundingBox();
    const contentBounds=await navigation.boundingBox();
    assert.ok(primaryBounds && contentBounds && contentBounds.x >= primaryBounds.x + primaryBounds.width, 'content navigation occupies its own column');
    assert.match(readFileSync(join(root,'docs/feature/browser-feature/use-case/browser-flow.md'),'utf8'),/^# Nested browser flow\n/u);
    await page.getByRole('tab',{name:'正文',exact:true}).click();
    await editor.locator('p').first().fill('External editor wins. Flushed from Feature.');
    await page.getByRole('tab',{name:'Use Cases',exact:true}).click();
    await expect(page.getByRole('tab',{name:'Use Cases',exact:true})).toHaveAttribute('data-state','active');
    assert.ok(readFileSync(path,'utf8').includes('Flushed from Feature.'));
    await nestedCase.click();
    const drawer=page.getByRole('dialog',{name:'Nested browser flow',exact:true});
    await expect(drawer).toBeVisible();
    await expect(page.locator('.page [inert]')).toContainText('Use Cases');
    await expect(drawer.getByRole('heading',{name:'Nested browser flow',exact:true}).first()).toBeVisible();
    await expect.poll(async () => {
      const bounds=await drawer.boundingBox();
      return bounds ? Math.round(bounds.x + bounds.width) : 0;
    }).toBe(1440);
    await page.goBack();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole('tab',{name:'Use Cases',exact:true})).toHaveAttribute('data-state','active');
    assert.equal(new URL(page.url()).searchParams.get('tab'),'use-cases');
    await page.locator('.feature-use-cases').getByRole('link').filter({hasText:'Nested browser flow'}).click();
    const drawerEditor=drawer.locator('[contenteditable="true"]').first();
    await expect(drawerEditor).toBeVisible();
    await drawerEditor.locator('p').first().fill('Saved Use Case body.');
    await expect.poll(()=>readFileSync(join(root,'docs/feature/browser-feature/use-case/browser-flow.md'),'utf8')).toContain('Saved Use Case body.');
    await drawerEditor.locator('p').first().fill('Saved on drawer close.');
    await drawer.getByRole('button',{name:'Close',exact:true}).click();
    await expect(drawer).toHaveCount(0);
    assert.ok(readFileSync(join(root,'docs/feature/browser-feature/use-case/browser-flow.md'),'utf8').includes('Saved on drawer close.'));
    await nestedCase.click();
    await page.reload();
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[contenteditable="true"]').first()).toBeVisible();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole('tab',{name:'Use Cases',exact:true})).toHaveAttribute('data-state','active');
    await page.getByRole('tab',{name:'正文',exact:true}).click();
    await expect(editor).toContainText('External editor wins.');
    // Give the main content enough width to exercise the sticky file-tree scroll contract.
    await page.setViewportSize({width:1920,height:1000});
    const documentTree=page.getByTestId('document-file-tree');
    await expect(documentTree).toHaveCSS('position','sticky');
    await documentTree.getByRole('button',{name:'architecture.md',exact:true}).click();
    await expect(editor).toContainText('Entity Ownership');
    await editor.locator('p').first().fill('Architecture from browser.');
    const documentPane=page.locator('.document-workspace > .page');
    await documentPane.evaluate(element=>{element.scrollTop=500;});
    await documentTree.evaluate(element=>{element.scrollTop=80;});
    const treeScrollBefore=await documentTree.evaluate(element=>element.scrollTop);
    await documentTree.getByRole('button',{name:'library.md',exact:true}).click();
    await expect.poll(()=>documentPane.evaluate(element=>element.scrollTop)).toBe(0);
    assert.equal(await documentTree.evaluate(element=>element.scrollTop),treeScrollBefore);
    const outerPage=page.locator('.document-workspace > .page');
    assert.equal(await page.getByTestId('document-file-preview').evaluate(element=>getComputedStyle(element).overflowY),'visible');
    assert.equal(await outerPage.evaluate(element=>getComputedStyle(element).scrollbarWidth),'none');
    assert.equal(await page.getByRole('tablist',{name:'文档详情'}).evaluate(element=>getComputedStyle(element).scrollbarWidth),'none');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(()=>readFileSync(join(root,'docs/feature/browser-feature/architecture.md'),'utf8')).toContain('Architecture from browser.');
    await expect(page).toHaveURL(/file=docs%2Ffeature%2Fbrowser-feature%2Flibrary.md/);
    await page.goBack();
    await expect(editor).toContainText('Architecture from browser.');
    assert.equal(new URL(page.url()).searchParams.get('file'), 'docs/feature/browser-feature/architecture.md');
    await page.goForward();
    await expect(page).toHaveURL(/file=docs%2Ffeature%2Fbrowser-feature%2Flibrary.md/);
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('link',{name:'Git 变更',exact:true}).click();
    await expect(page.getByRole('complementary',{name:'Git 变更 侧栏'})).toBeVisible();
    const gitTree = page.getByRole('navigation',{name:'Git 文件树',exact:true});
    await expect(page.getByRole('complementary', {name:'Git 变更 侧栏'}).getByRole('tablist', {name:'变更分类'})).toBeVisible();
    await expect(gitTree.getByRole('button',{name:'docs/feature/browser-feature/README.md',exact:true})).toBeVisible();
    await gitTree.getByRole('button',{name:'docs/feature/browser-feature/README.md',exact:true}).click();
    await expect(page.locator('[data-git-diff]')).toContainText('External editor wins.');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const treeBounds = await gitTree.boundingBox();
    const diffBounds = await page.locator('[data-git-diff]').boundingBox();
    assert.ok(treeBounds && diffBounds && diffBounds.x >= treeBounds.x + treeBounds.width, 'Git diff stays beside the file tree');
    await gitTree.getByRole('button',{name:'docs 目录',exact:true}).click();
    await expect(gitTree.getByRole('button',{name:'docs/feature/browser-feature/README.md',exact:true})).toBeHidden();
    await gitTree.getByRole('button',{name:'docs 目录',exact:true}).click();
    writeFileSync(path,readFileSync(path,'utf8').replace('External editor wins.','Refreshed Git content.'));
    await page.getByRole('button',{name:'刷新',exact:true}).click();
    await expect(page.locator('[data-git-diff]')).toContainText('Refreshed Git content.');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link',{name:'项目设置',exact:true}).click();
    await expect(page.getByLabel('Project ID',{exact:true})).toHaveCount(0);
    const timeoutSave = page.waitForResponse(response => response.url().endsWith('/api/action') &&
      (response.request().postDataJSON() as { action?: string; config?: { runner?: { timeoutMs?: number } } }).action === 'config.set' &&
      (response.request().postDataJSON() as { config?: { runner?: { timeoutMs?: number } } }).config?.runner?.timeoutMs === 11111);
    await page.getByLabel('运行超时',{exact:true}).fill('11111');
    assert.equal((await timeoutSave).status(), 200);
    await expect.poll(()=>readProjectConfig(root).runner?.timeoutMs).toBe(11111);
    await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);
    await expect(page.getByRole('status')).toContainText('已自动保存');
    // 暂缓真实保存请求，分别观察草稿与回读，避免把自动保存速度当作断言条件。
    const configSaveGate = await Effect.runPromise(Deferred.make<void>());
    const configSaveEntered = await Effect.runPromise(Deferred.make<void>());
    const configSaved = page.waitForResponse(response => response.url().endsWith('/api/action') &&
      (response.request().postDataJSON() as { action?: string }).action === 'config.set');
    await page.route('**/api/action', async route => {
      await Effect.runPromise(Deferred.succeed(configSaveEntered, undefined));
      await Effect.runPromise(Deferred.await(configSaveGate));
      await route.continue();
    });
    try {
      await page.getByLabel('源码目录',{exact:true}).fill('src\n');
      await expect(page.getByLabel('源码目录',{exact:true})).toHaveValue('src\n');
      await Effect.runPromise(Deferred.await(configSaveEntered));
    } finally {
      await Effect.runPromise(Deferred.succeed(configSaveGate, undefined));
    }
    assert.equal((await configSaved).status(), 200);
    await page.unroute('**/api/action');
    // Wait for the preceding save/readback to finish before introducing an external edit.
    await expect(page.getByLabel('源码目录',{exact:true})).toHaveValue('src');
    await expect(page.getByRole('status')).toContainText('已自动保存');
    await page.getByLabel('运行超时',{exact:true}).fill('12345');
    const configPath=join(root,projectConfigPath(root));
    const config=readProjectConfig(root);
    writeProjectConfig(root,{...config,runner:{...config.runner,timeoutMs:54321}});
    const externalConfig=readFileSync(configPath,'utf8');
    await expect(page.locator('.form-error').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByLabel('运行超时',{exact:true})).toHaveValue('12345');
    assert.equal(readFileSync(configPath,'utf8'),externalConfig,'polled digests must not let stale config overwrite disk');
    await page.getByRole('tab',{name:'高级 JSON',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'离开并丢弃未保存内容？'})).toBeVisible();
    await page.getByRole('button',{name:'丢弃并离开',exact:true}).click();
    // 丢弃冲突草稿后等待当前配置回读，避免在旧投影即将被替换时开始另一份草稿。
    await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);
    await expect(page.getByLabel('高级项目配置 JSON',{exact:true})).toHaveValue(/"timeoutMs": 54321/u, { timeout: 65_000 });
    await page.getByLabel('高级项目配置 JSON',{exact:true}).fill('{"testRoots":false}');
    await page.getByRole('tab',{name:'常用设置',exact:true}).click();
    await expect(page.getByLabel('高级项目配置 JSON',{exact:true})).toHaveValue('{"testRoots":false}');
    await expect(page.locator('.form-error').first()).toBeVisible();
    await page.getByRole('button',{name:'留在此页',exact:true}).click();
    await sidebar.getByRole('link',{name:'Feature',exact:true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button',{name:'丢弃并离开',exact:true}).click();
    // 配置身份变化后必须等待新投影；旧身份不能继续提供导航。
    await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);
    await expect(navigation).toBeVisible();
    await navigation.getByRole('link',{name:'Browser authoring',exact:true}).click();
    writeFileSync(join(root,'src/demo.ts'),'// @concord-file\n// @concord-implements docs/feature/browser-feature/README.md\nexport const demo = 1;\n');
    mkdirSync(join(root,'test'),{recursive:true});
    writeFileSync(join(root,'test/demo.test.ts'),"import test from 'node:test';\n// @use-case docs/feature/browser-feature/use-case/browser-flow.md\ntest('Added browser test', () => {});\n" + Array.from({length:100},(_,index)=>`// Reading fixture ${index}\n`).join(''));
    const base = `http://127.0.0.1:${server.port}`;
    assert.equal((await page.request.post(`${base}/api/workspace`, { data: {} })).status(), 202);
    await pollUntil(async () => (await waitForWorkspaceProjection(base)).snapshot.cases.some(item => item.file === 'test/demo.test.ts') ? true : undefined,
      { description: 'external test declaration generation' });
    await page.reload();
    await expect(page.getByRole('tab',{name:'测试',exact:true})).toBeVisible();
    await page.getByRole('tab',{name:'测试',exact:true}).click();
    const markerName = 'docs/feature/browser-feature/use-case/browser-flow.md#0';
    await expect(page.getByText(markerName,{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'查看测试源码',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('Added browser test');
    await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:'实现',exact:true}).click();
    await page.getByRole('button',{name:/^src\/demo\.ts · 第 /}).click();
    const source=page.getByLabel('源码原文',{exact:true});
    await source.fill('export const demo = 2;\n');
    await expect.poll(()=>readFileSync(join(root,'src/demo.ts'),'utf8')).toBe('export const demo = 2;\n');
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await sidebar.getByRole('link',{name:'Git 变更',exact:true}).click();
    await expect(page.getByRole('tab',{name:/全部/})).toHaveAttribute('aria-selected','true');
    await expect(gitTree.getByRole('button',{name:'src/demo.ts',exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:'新增测试用例',exact:true})).toHaveCount(0);
    await page.getByRole('tab',{name:/测试用例/}).click();
    await expect(gitTree).toContainText(markerName);
    await expect(gitTree).not.toContainText('src/demo.ts');
    await gitTree.getByRole('button').filter({hasText:markerName}).click();
    await expect(page.locator('[data-git-diff]')).toContainText('Added browser test');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/line=2/);
    await expect(page.locator('[data-git-diff] #git-line-2')).toBeVisible();
    const diffScroll = page.getByTestId('git-diff-scroll');
    await diffScroll.evaluate(element => { element.scrollTop = 250; });
    await expect.poll(() => diffScroll.evaluate(element => element.scrollTop)).toBe(250);
    await page.getByRole('tab',{name:/文档/}).click();
    await gitTree.getByRole('button',{name:'docs/feature/browser-feature/README.md',exact:true}).click();
    await page.getByRole('tab',{name:/测试用例/}).click();
    await expect(gitTree.getByRole('button',{name:'test/demo.test.ts',exact:true})).toHaveAttribute('aria-current','page');
    await expect.poll(() => diffScroll.evaluate(element => element.scrollTop)).toBe(250);
    await page.getByRole('tab',{name:/文档/}).click();
    await expect(gitTree.getByRole('button',{name:'docs/feature/browser-feature/README.md',exact:true})).toHaveAttribute('aria-current','page');
    await page.getByRole('tab',{name:'分栏',exact:true}).click();
    await expect(page).toHaveURL(/view=split/);
    await page.getByRole('tab',{name:'统一',exact:true}).click();
    await expect(page).toHaveURL(/view=unified/);
    await page.goBack();
    await expect(page.getByRole('tab',{name:'分栏',exact:true})).toHaveAttribute('data-state','active');
    await page.reload();
    await expect(page.getByRole('tab',{name:'分栏',exact:true})).toHaveAttribute('data-state','active');
    await page.getByRole('tab',{name:/测试用例/}).click();
    await page.reload();
    await expect(page.locator('[data-git-diff]')).toContainText('Added browser test');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('tab',{name:/测试用例/})).toHaveAttribute('aria-selected','true');
    await expect(sidebar.getByRole('link',{name:'测试',exact:true})).toHaveCount(0);
    await expect(sidebar.getByRole('link',{name:'实现',exact:true})).toHaveCount(0);
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'内容导航',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('test');
    await gitTree.getByRole('button',{name:'test/demo.test.ts',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-git-diff]')).toContainText('Added browser test');
    await page.getByRole('button',{name:'Toggle Sidebar',exact:true}).click();
    await expect(page.getByRole('link',{name:'Feature',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'Feature',exact:true}).click();
    await expect(page.locator('[data-mobile="true"]')).toHaveCount(0);
    await page.getByRole('button',{name:'内容导航',exact:true}).click();
    await navigation.getByRole('link',{name:'Browser authoring',exact:true}).click();
    await page.getByRole('tab',{name:'Use Cases',exact:true}).click();
    await nestedCase.click();
    await expect(page.getByRole('heading',{name:'Nested browser flow',exact:true}).first()).toBeVisible();
    await expect(page.locator('[data-mobile="true"]')).toHaveCount(0);
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'新建 Feature',exact:true}).click();
    await expect(page.getByLabel('Feature ID',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'取消',exact:true}).click();
    assert.deepEqual(errors,[]);
  } finally {await server?.close();rmSync(root,{recursive:true,force:true});}
});
