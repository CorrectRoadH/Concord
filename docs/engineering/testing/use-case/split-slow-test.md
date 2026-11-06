# 拆分慢测试

## 用户目标

门禁报告显示某个测试文件超过 60 秒，或某个测试超过所在层的 p50 上限。维护者想让它回到上限内，而不提高上限、不删断言。

## 起始状态

- 最近一次门禁已运行完，`.test-results/run-*` 中有本次报告。
- 上限见[成本与稳定](../README.md#成本与稳定)与[分层](../README.md#分层)。

## 完整路径

1. 找到慢的文件。 {#find}

   门禁输出开头的 `# Test diagnostics:` 给出报告目录，其中 `file-timings.json` 按耗时从长到短列出测试文件：

   ```json
   [
     {
       "file": "/home/me/Code/Concord/test/cli/onboarding-independent.test.ts",
       "duration_ms": 103939.737281,
       "success": true,
       "cases": 8
     }
   ]
   ```

   `layer-timings.json` 按层汇总文件数、用例数与耗时。每个文件结束时，门禁输出中也有一行 `# Node file: <路径>; <秒>s; success=<结果>; logs=<目录>`。

2. 确认耗时来自测试本身。 {#confirm}

   门禁输出开头的 `# Machine load:` 行记录运行时的 load average。过载或并发运行其它门禁时，在空闲机器上复跑这个文件后再判断（[共享资源与同步](../README.md#共享资源与同步)）：

   ```sh
   pnpm gate test/cli/onboarding-independent.test.ts
   ```

3. 先把领域情形下沉一层。 {#sink}

   逐个测试看它在验证什么。CLI 或进程层里枚举领域情形的测试，改写到 `test/domain/`，用进程内入口观察同一结果；原层只保留一个代表行，验证参数、退出码或跨进程的映射。准备步骤用子进程逐条执行 CLI 时，改用 `createDocument`、`linkIssue` 这类进程内入口，例子见[写行为测试](write-behavior-test.md#write)。

4. 仍超出时按主题拆文件。 {#split}

   把文件中的测试分到 `<主题>.test.ts`、`<主题>-2.test.ts`、`<主题>-3.test.ts`，各文件由 runner 并发执行。几个文件共用的准备移到 `test/support/<主题>-fixture.ts`，例如 `test/process/editor-lsp.test.ts` 到 `editor-lsp-5.test.ts` 共用 `test/support/editor-fixture.ts`：

   ```ts
   import { test, run, source, testText, reference, file } from '../support/editor-fixture.ts';
   ```

   每个测试连同它的标记一起移动，不改标记目标；带 `@name` 的测试保持 `@name`，关联 ID 不变。

5. 运行拆分后的文件，核对耗时。 {#run}

   ```sh
   pnpm gate test/process/editor-lsp.test.ts test/process/editor-lsp-2.test.ts
   ```

   在新的 `file-timings.json` 中，每个文件都不超过 60 秒，用例总数与拆分前相同。交付前运行 `pnpm gate --changed`；改动了 `test/support/` 时它选中全部测试（[扩展 Fixture](extend-fixtures.md#run)）。

## 结果

测试文件回到上限内，断言与关联不变，交付说明写明拆分前后的耗时与运行的选择。

| 情形 | 处理 |
| --- | --- |
| 只在负载高时超出 | 空闲机器复跑后仍超出才处理；复跑通过的失败登记为 Issue |
| 一个测试本身就超过层上限 | 拆分文件无济于事；下沉领域情形，或找出等待中的固定时长与重复启动 |
| 测试靠 `sleep` 等待 | 改为等待真实状态（[扩展 Fixture](extend-fixtures.md#wait)） |
| 拆分后用例数变少 | 有测试在移动时丢失；按 `cases` 对照补回 |
| 想提高上限或把文件超时调大 | 不提高上限（[成本与稳定](../README.md#成本与稳定)） |
| 拆分后的文件依赖执行顺序 | 每个文件独立准备自己的状态；依赖全局状态的用例留在同一文件内串行 |
