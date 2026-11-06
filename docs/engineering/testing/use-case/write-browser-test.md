# 写浏览器测试

## 用户目标

维护者想验证 Web 工作台的一条用户路径：用户在页面上看到什么、点哪里、结果落到哪里。下层测试观察不到导航、草稿保护与呈现时，才写浏览器测试。

## 起始状态

- 要验证的路径已写在 Web 工作台的 Use Case 中，例如[使用 Web 工作台](../../../feature/web-workbench/use-case/use-web-workbench.md)：工作区不完整时，提示条把用户带到健康诊断。
- 开发环境装有 Chromium，方式见[浏览器环境](../cli.md#浏览器环境)。

## 完整路径

1. 新建 `test/e2e/<主题>.e2e.ts`，从本目录的 `fixtures.ts` 引入 `test`。 {#create}

   这个 `test` 为每个测试提供 `page` 与 `workspace`。`workspace` 是本 worker 共用的临时仓库及其工作区服务，测试开始前已恢复到 fixture 的冻结提交（[浏览器与诊断](../architecture.md#浏览器与诊断)）。

2. 在共用仓库上准备状态，然后等服务刷新。 {#setup}

   ```ts
   import { mkdirSync, writeFileSync } from 'node:fs';
   import { join } from 'node:path';
   import { expect } from '@playwright/test';
   import { test } from './fixtures.ts';
   import { act } from './journey.ts';
   import { createDocument } from '../support/operations.ts';
   import { LocalRepository } from '../support/repository.ts';

   // @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
   // @name dismissible-workspace-health-navigation
   test('incomplete workspace notice opens health diagnostics', { tags: ['journey'] }, async fixtures => {
     const { page, workspace } = fixtures;
     const repo = new LocalRepository(workspace.root);
     try {
       createDocument(repo, 'engineering', { id: 'health', title: 'Health example' });
     } finally { repo.close(); }
     mkdirSync(join(workspace.root, 'docs/feature/broken'));
     writeFileSync(join(workspace.root, 'docs/feature/broken/README.md'), '---\nformat: concord.document/v1\nkind: feature\nid: broken\n---\n');
     const server = await workspace.ready();
   ```

   受管文件由 `createDocument` 生成；故意损坏的 `README.md` 是这条路径要求的无效输入。`workspace.ready()` 请求刷新，并等到投影包含这次改动后才返回，不按时间等待。

3. 像用户一样操作，断言可观察结果。 {#act}

   ```ts
     await page.goto(`http://127.0.0.1:${server.port}/engineering/health`);
     const notice = page.getByRole('link', { name: /查看工作区健康/ });
     await expect(notice).toBeVisible({ timeout: 15000 });
     await act(fixtures, '通过当前页面的工作区健康提示，打开健康诊断。', () => notice.click());
     await expect(page).toHaveURL(/\/overview#workspace-health$/);
     await expect(page.locator('#workspace-health')).toContainText('docs/feature/broken/README.md');
   });
   ```

   定位用角色与可访问名称。`act` 来自 `test/e2e/journey.ts`：普通门禁执行第三个参数中的确定性操作，[自然语言运行](../cli.md#自然语言运行)交给模型执行第二个参数的指令，两种模式共用后面的精确断言。只有[自然语言用例](../README.md#自然语言用例)列出的那类操作才加 `{ tags: ['journey'] }` 与 `act`。

4. 需要独占服务状态时另起仓库与服务。 {#private}

   停止、重启服务或模拟恢复这类测试不能改动共用服务。`workspace.privateRoot()` 给出本 worker 拥有的空目录，`workspace.privateServer({ root, host: '127.0.0.1', port: 0 })` 在其中启动服务，worker 负责回收。`test/e2e/operation-boundaries-browser.e2e.ts` 是一个例子。

5. 运行这个文件。 {#run}

   ```sh
   pnpm gate test/e2e/workspace-health.e2e.ts
   ```

   文件路径路由到浏览器 runner；静态检查与构建仍完整执行。交付时运行 `pnpm gate --changed`。

6. 失败时读现场。 {#diagnose}

   门禁输出开头的 `# Test diagnostics:` 给出本次的 `.test-results/run-*` 目录。浏览器结果在其中的 `e2e/results/<文件与测试名>-<摘要>/attempt-1/`，失败时保留现场，例如 `screenshots/` 与 `screen-at-failure.txt`。

## 结果

测试在真实 Chromium 中走完一条用户路径，标记把它关联到 Use Case；路径中的文件持久化与路由由精确断言判断。

| 情形 | 处理 |
| --- | --- |
| 断言的是请求顺序、计数或返回的 JSON | 写在下层：HTTP 与领域结果在 `test/process/` 或 `test/domain/` 测试 |
| 测试用 `page.waitForTimeout` 等页面变化 | 改为 `expect(...).toBeVisible()` 这类等待真实状态的断言，或 `page.waitForResponse` 等具体响应 |
| 涉及时钟推进 | 用 `page.clock` 注入时间，例如 `test/e2e/view-performance-browser.e2e.ts` |
| 准备后页面仍显示旧内容 | 准备步骤之后调用 `workspace.ready()` 再导航 |
| 为一个测试另起浏览器或 `startViewServer` | 改用共用的 `page` 与 `workspace`；确需独占时用 `privateRoot` 与 `privateServer` |
| 启动时报找不到浏览器 | 按[浏览器环境](../cli.md#浏览器环境)安装 Chromium，或设置 `CONCORD_BROWSER_PATH` |
| 单个测试超过 20s | 把非界面的情形下沉；仍超出时按[拆分慢测试](split-slow-test.md)处理 |
