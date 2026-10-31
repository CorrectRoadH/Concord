# 测试集与测试架构的差距

## 现象

[测试架构](../engineering/concord-self-hosting/test-architecture.md)规定了分层、fixture 与成本上限，当前测试集与之有差距。2026-10-30 最近一次完整运行（`.test-results/run-3NTz53`）：96 个 Node 测试文件的单文件耗时合计约 6644 秒，按 8 路并发约 14 分钟，上限为单机 5 分钟。

## 差距

- 超过 60 秒上限的文件包括 `cli.test.ts`（457 秒）、`issue-remote.test.ts`（415 秒）与 `asynchronous-projections.test.ts`（318 秒）。`documents.test.ts` 有 23 个进程内测试，耗时 288 秒。
- 108 个测试文件中 82 个依赖 `dist/`：75 个从 `../dist/` 导入模块，45 个直接运行 `dist/entry.js` 而不是安装后的 bin；只有 12 个从 `src/` 导入。纯函数层与仓库内层应改为从 `src/` 导入，打包 CLI 层改为运行安装后的 bin。
- 49 个测试文件启动打包 CLI，许多领域情形在打包 CLI 层逐行测试，应下移到纯函数或仓库内层。
- 测试源码中有 47 处手写的受管格式文本，格式改变时需要逐个修改测试。
- 没有模板消费者，每个测试重新执行 `git init` 与初始化。
- 测试运行没有按文件耗时与子进程启动次数的报告。
- `concord trace gaps` 的当前缺口尚未逐项对应 Issue。
