# 一次提交核验小修复

## 用户目标

工程师发现一个缺陷并当场修好，改动只有几行。他要的证明与大缺陷相同：回归测试在没有修复时失败，有修复时通过。
他不想为此建 Issue 文件、把测试和修复拆成两个提交，再回头关闭 Issue。Concord 直接从暂存区核验：
测试与修复写在一起、暂存、核验、一次提交，结论写进这次提交的说明。

Issue 只在工作要留到以后或交给别人时才需要，流程见[核验修复并关闭缺陷](resolve-with-command-evidence.md)。

## 起始状态

- 仓库已运行 `concord init`，`concord.config.ts` 的 `runner` 或 `testAdapters` 能执行测试文件，`testRoots` 标出测试所在目录。
- 下文的例子：购物车 `addItem` 第二次加入同一 SKU 时覆盖了数量，应该累加。

## 完整路径

本页示例为预期输出。

1. 写回归测试和修复，一起暂存。 {#stage-test-and-fix}

   ```js
   // @use-case docs/feature/cart/use-case/add-item.md
   test('adding the same sku twice sums the quantity', () => { ... });
   ```

   ```sh
   git add test/cart.test.js src/cart.js
   ```

   测试带它守护的 Use Case 或 Feature 标记，不需要 `@issue`。

2. 从暂存区核验。 {#verify-staged}

   ```sh
   concord test verify --staged
   ```

   ```text
   Verified fix — staged changes on 3f2a91c
   Red: 3f2a91c + staged tests (tree 51c0e7a, runner exit 1)
   Green: staged tree 9b4d2f0 (runner exit 0)
   Tests: neref_854212737ecad7effc4666629752cb98
   Runner: sha256:4b1e...

   Put the lines above in your commit message.
   ```

   Concord 用暂存区推导出两份快照，各自检出到轻量临时 worktree 中运行：

   - **红**：HEAD 加上暂存区里位于 `testRoots` 之下的改动。它是“有了回归测试、还没有修复”的状态。
   - **绿**：HEAD 加上暂存区的全部改动。它就是即将提交的内容。

   被核验的测试是暂存区相对 HEAD 新增或正文有变化的测试用例；同一文件里没有变化的用例不参与，它们在红快照上本来就应该通过。
   一条用例由它的标记块标识，正文是标记块结束之后到同一文件下一个标记块之前的文本，最后一条用例的正文到文件末尾。
   标记在 HEAD 中不存在的用例算新增；标记相同而正文文本不同的用例算有变化，比较按原文逐字符进行，不忽略空白与注释。
   文件里第一个标记块之前的内容不属于任何用例，只改这一段不会选中用例。

   每条被核验的用例在红快照上必须失败、在绿快照上必须通过。原生 adapter 按用例运行，这条保证逐条成立。
   command runner 在测试没有 `@name` 时只能运行整个文件，保证落在文件上：含有被核验用例的每个文件在红快照上以非零退出、
   在绿快照上以零退出。此时结论的 `Tests` 仍列出被选中的用例，`--json` 的每个运行结果用 `scope: "file"` 标出证明的是文件，
   按用例运行时是 `scope: "case"`。

   命令不创建提交、不移动任何引用、不修改暂存区与工作目录。未暂存的改动不参与核验。

3. 提交，把结论写进说明。 {#commit-with-conclusion}

   ```sh
   git commit
   ```

4. 以后重放。 {#replay}

   ```sh
   concord --json test verify --fix 8c04d7e
   ```

   只给修复提交时，红快照是它的第一个父提交加上它在 `testRoots` 之下的改动，绿快照是它本身，被核验的测试是它新增或改动的用例。
   提交的 tree 与结论里的 `staged tree` 相同时，重放与提交前的核验运行的是同一份内容。

## 结果

`test verify --staged` 核验成立时退出 0，不成立时退出 1，都不写文件。`--json` 输出 `operation: "test-verify"`、`base`（HEAD 提交）、
`redTree`、`greenTree`、`tests`、`runner`，以及红、绿两次运行各自的结果，字段与[核验修复并关闭缺陷](resolve-with-command-evidence.md)的重放输出相同。

| 错误 | 触发条件 |
| --- | --- |
| `FixUnverifiable` | 暂存区为空；暂存区里没有新增或改动的测试用例；暂存区的改动全部位于 `testRoots` 之下，红、绿快照相同 |
| `FixUnverifiable` | 某条被核验的用例在红快照上通过。测试没有守住这次修复，或它依赖的测试辅助代码不在 `testRoots` 之下 |
| `FixUnverifiable` | 依赖锁文件在暂存区里有改动；任一次运行超时、被取消或清理无法确认；进程没有正常结束 |
| `FixVerificationFailed` | 某条被核验的用例在绿快照上失败 |

`issue close <id> --fixed` 使用同一条推导：回归测试与修复位于同一个提交时，红快照取该提交的第一个父提交加上它在 `testRoots` 之下的改动，
不再因为“测试与修复在同一提交”而拒绝。测试与修复分在两个提交时行为不变。

## 边界

- 红快照只带上 `testRoots` 之下的改动。回归测试需要的新辅助代码放在 `testRoots` 之外时，红快照会因为缺少它而失败；
  使用原生 adapter 时这种失败是 invalid 而不是 red，核验以 `FixUnverifiable` 结束；command runner 不区分这两者。
- 核验只证明选中的用例在两份快照上的结果，不证明其它测试仍然通过；完整回归由项目自己的测试与 CI 负责。
- 一次暂存里混有与这次修复无关的改动时，它们同样进入绿快照。小修复应当单独暂存。
