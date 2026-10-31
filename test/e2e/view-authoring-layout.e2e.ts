import assert from 'node:assert/strict';
import { test } from './fixtures.js';
import { expect } from '@playwright/test';
import { type ViewServerHandle, startViewServer } from './server.js';
import { rmSync } from 'node:fs';
import { waitForWorkspaceProjection } from '../support/support.js';
import { authoringConsumer } from '../support/view-authoring-fixture.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('browser navigates owner directories and preserves implementation and document layouts', async ({ page }) => {
  const root = authoringConsumer();
  let server: ViewServerHandle | undefined;
  try {
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
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
    assert.deepEqual(errors,[]);
  } finally { await server?.close(); rmSync(root, { recursive: true, force: true }); }
});
