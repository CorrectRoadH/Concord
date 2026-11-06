# 测试命令

本页给出运行本仓库测试的命令、参数与环境变量。检查阶段与验收规则见[测试](README.md)。

## 完整门禁

```sh
pnpm gate [--changed [<base>]] [--test-name-pattern=<表达式>] [--test-shard=<序号>/<总数>] [<测试文件>...]
```

| 参数 | 作用 |
| --- | --- |
| 测试文件 | 只运行这些文件。省略时递归发现 `test/` 下的 `*.test.ts` 与 `test/e2e/` 下的 `*.e2e.ts` |
| `--changed [<base>]` | 只运行受改动影响的测试。改动是 `<base>`（默认 `origin/master` 与 HEAD 的 merge-base）到工作区的全部差异；选中改动的测试文件，以及测试标记指向的 Spec 与改动有关的测试：改动的 Spec 页面，或改动的源码文件通过代码声明关联的 Spec。改动了 `test/support/`、`scripts/`、`package.json` 或锁文件时选中全部测试 |
| `--test-name-pattern=<表达式>` | 只运行标题匹配的测试 |
| `--test-shard=<序号>/<总数>` | 运行一个分片。分片分别作用于 Node 测试与浏览器测试，所有分片的并集覆盖完整集合，不保证与以往相同的分组 |

退出 0 表示全部检查通过；非零表示违规、输入不完整或执行失败。Node 测试与浏览器测试互不阻止，任一失败使整体失败。给出文件或过滤条件时静态检查仍完整执行。

本地交付运行 `pnpm gate --changed`；推送到 master 后，CI 的四个分片各运行 `pnpm gate --test-shard=<序号>/4`，并集是完整集合，失败由引入它的人立即修复。报告写入每次调用独立的 `.test-results/run-*`，其中有按耗时排序的测试文件与子进程启动次数；CI 按分片上传。

`test/*.test.ts` 交给 Node test，`test/e2e/*.e2e.ts` 交给浏览器 runner。按文件执行与按标题过滤路由到相应 runner。

## 并发

| 变量 | 默认值 | 规则 |
| --- | --- | --- |
| `CONCORD_TEST_CONCURRENCY` | `min(8, floor(可用 CPU / 2), floor(可用内存 / 1 GiB))`，至少 1 | Node 测试的文件进程并发，必须为正整数；可用内存取门禁 scope 的 `MemoryMax` 减去浏览器 worker 的预算 |
| `CONCORD_E2E_WORKERS` | `min(4, Node 并发, floor(MemoryMax / 4 / 2.5 GiB))`，至少 1 | 浏览器测试的 worker 数；每个 worker 的预算 2.5 GiB 含它的浏览器与工作区服务 |

本地与 CI 使用相同的默认值。默认值改变时，用同一冻结快照按[性能测量](../performance/README.md#测量方法)测量前后两种设置。

## 浏览器环境

`pnpm gate` 包含真实 Chromium 的界面验收。

| 方式 | 作用 |
| --- | --- |
| `pnpm exec playwright install chromium` | 在开发环境安装浏览器 |
| `CONCORD_BROWSER_PATH=<可执行文件>` | 使用已有的浏览器 |
| NixOS | 默认识别 `/run/current-system/sw/bin/chromium` |

测试只启动隔离 Git 消费者，不在真实项目内运行示例测试命令。

## 自然语言运行

```sh
vp run test:e2e:agent
```

只选择标有 `journey` 的用例，由 `agent.act` 完成用户操作，精确断言与普通门禁相同。它会调用付费模型，执行须获得授权，不属于日常门禁。

| 变量 | 作用 |
| --- | --- |
| `E2E_MODEL_API_KEY` | 模型凭据 |
| `E2E_MODEL_BASE_URL` | 模型服务地址 |
| `E2E_MODEL` | 模型名称 |

每次操作有模型调用与步数上限，禁止以缓存替代实际执行。
