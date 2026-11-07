import assert from 'node:assert/strict';
import { test } from './fixtures.ts';
import { expect } from '@playwright/test';
import { type ViewServerHandle } from './server.ts';
import { Deferred, Effect } from 'effect';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pollUntil, projectConfigPath, readProjectConfig, waitForWorkspaceProjection, writeProjectConfig } from '../support/support.ts';
import { replayAuthoringState } from '../support/view-authoring-fixture.ts';
import { prepareAuthoringFixture } from './authoring-fixture.ts';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('browser preserves project configuration conflicts and navigates test evidence on narrow screens', async ({ page, workspace }) => {
  const root = workspace.root;
  (await prepareAuthoringFixture(root));
  let server: ViewServerHandle | undefined;

  (await replayAuthoringState(root));
  server = await workspace.ready();
  await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);
  await page.setViewportSize({width:1440,height:1000});
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}/features/browser-feature`);
  await expect(page.getByRole('heading',{name:'Browser authoring',exact:true}).first()).toBeVisible();
  assert.equal(await page.getByRole('link',{name:'Feature',exact:true}).evaluate(element=>getComputedStyle(element).display),'flex','sidebar must forward shadcn classes to its links');
  assert.equal(await page.locator('[data-slot="sidebar"]').getByRole('link',{name:'Use Case',exact:true}).count(),0);
  const sidebar=page.locator('[data-slot="sidebar"]');
  const navigation=page.getByRole('navigation',{name:'内容导航',exact:true});
  const nestedCase=page.locator('.feature-use-cases').getByRole('link').filter({hasText:'Nested browser flow'});
  const gitTree = page.getByRole('navigation',{name:'Git 文件树',exact:true});
  await page.getByRole('link',{name:'项目设置',exact:true}).click();
  await expect(page.getByLabel('Project ID',{exact:true})).toHaveCount(0);
  const timeoutSave = page.waitForResponse(response => response.url().endsWith('/api/action') &&
    (response.request().postDataJSON() as { action?: string; config?: { runner?: { timeoutMs?: number } } }).action === 'config.set' &&
    (response.request().postDataJSON() as { config?: { runner?: { timeoutMs?: number } } }).config?.runner?.timeoutMs === 11111);
  await page.getByLabel('运行超时',{exact:true}).fill('11111');
  assert.equal((await timeoutSave).status(), 200);
  await expect.poll(async ()=>(await readProjectConfig(root)).runner?.timeoutMs).toBe(11111);
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
  const config=(await readProjectConfig(root));
  writeProjectConfig(root,{...config,runner:{...config.runner,timeoutMs:54321}});
  const externalConfig=readFileSync(configPath,'utf8');
  await expect(page.locator('.form-error').first()).toBeVisible({ timeout: 60000 });
  await expect(page.getByLabel('运行超时',{exact:true})).toHaveValue('12345');
  assert.equal(readFileSync(configPath,'utf8'),externalConfig,'polled digests must not let stale config overwrite disk');
  await page.getByRole('tab',{name:'高级 JSON',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'离开并丢弃未保存内容？'})).toBeVisible();
  await page.getByRole('button',{name:'丢弃并离开',exact:true}).click();
  // 丢弃草稿与从磁盘重新载入是两个动作；显式读取外部配置后再编辑。
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
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
  await expect(source).toContainText('export const demo = 1;');
  const sourceSaved = page.waitForResponse(response => {
    if (!response.url().endsWith('/api/action')) return false;
    const input = response.request().postDataJSON() as { action?: string; path?: string; body?: string };
    return input.action === 'source.set' && input.path === 'src/demo.ts' && input.body === 'export const demo = 2;\n';
  });
  const sourceStarted = performance.now();
  await source.fill('export const demo = 2;\n');
  const sourceReceipt = await sourceSaved;
  assert.equal(sourceReceipt.status(), 200);
  await sourceReceipt.finished();
  console.info('Source autosave receipt', { elapsedMs: performance.now() - sourceStarted, timing: sourceReceipt.request().timing() });
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

});
