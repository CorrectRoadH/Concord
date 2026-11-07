import assert from 'node:assert/strict';
import { test } from './fixtures.ts';
import { expect } from '@playwright/test';
import { type ViewServerHandle } from './server.ts';
import { waitForWorkspaceProjection } from '../support/support.ts';
import { prepareAuthoringFixture } from './authoring-fixture.ts';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('browser navigates owner directories and preserves implementation and document layouts', async ({ page, workspace }) => {
  const root = workspace.root;
  (await prepareAuthoringFixture(root));
  let server: ViewServerHandle | undefined;

  server = await workspace.ready();
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
  for (const [category,title,section] of [['Engineering','Build workflow','engineering'],['Roadmap','Future direction','roadmap'],['Design','Design options','design']] as const) {
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
      const diagramColors = () => diagram.evaluate(element => Array.from(element.querySelectorAll('rect, path, text')).map(node => {
        const style = getComputedStyle(node);
        return [style.fill, style.stroke, style.color];
      }));
      const initialDiagram=await diagramColors();
      await page.locator('.theme-toggle').click();
      await expect.poll(diagramColors).not.toEqual(initialDiagram);
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
    if (category === 'Design') {
      await expect(page.getByTestId('document-file-tree')).toHaveCount(0);
      await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
    } else {
      const tree=page.getByTestId('document-file-tree');
      await expect(tree).toBeVisible();
      const disclosure=tree.getByRole('button',{name:'文件',exact:true});
      if (await disclosure.isVisible()) await disclosure.click();
      await tree.getByRole('button',{name:'architecture.md',exact:true}).click();
      await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
    }
    await expect(list.getByRole('link',{name:title,exact:true})).toBeVisible();
  }
  await sidebar.getByRole('link',{name:'Feature',exact:true}).click();
  assert.deepEqual(errors,[]);

});

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md#页面选择
test('browser creates Engineering with all nine optional page kinds', async ({ page, workspace }) => {
  const root = workspace.root;
  (await prepareAuthoringFixture(root));
  let server: ViewServerHandle | undefined;

  server = await workspace.ready();
  await waitForWorkspaceProjection(`http://127.0.0.1:${server.port}`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://127.0.0.1:${server.port}/engineering`);
  await page.getByRole('button', { name: '新建 Engineering', exact: true }).click();
  await page.getByLabel('Engineering ID', { exact: true }).fill('browser-engineering');
  await page.getByLabel('Engineering 标题', { exact: true }).fill('Browser Engineering');
  for (const label of ['Use Cases', 'CLI', 'Library', 'API', 'Format', 'UI', 'Performance', 'Architecture', 'Data Model']) {
    await page.getByRole('checkbox', { name: label, exact: true }).check();
  }
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', { name: '内容导航', exact: true }).getByRole('link', { name: 'Browser Engineering', exact: true }).click();
  const tree = page.getByTestId('document-file-tree');
  await expect(tree).toBeVisible();
  const disclosure = tree.getByRole('button', { name: '文件', exact: true });
  if (await disclosure.isVisible()) await disclosure.click();
  for (const filename of ['cli.md', 'library.md', 'api.md', 'format.md', 'ui.md', 'performance.md', 'architecture.md', 'data-model.md']) {
    await expect(tree.getByRole('button', { name: filename, exact: true })).toBeVisible();
  }
  await expect(tree.getByRole('button', { name: 'use-case', exact: true })).toBeVisible();

});
