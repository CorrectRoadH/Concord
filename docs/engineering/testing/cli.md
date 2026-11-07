# 测试命令

本页给出运行本仓库测试的命令、参数与环境变量。检查阶段与验收规则见[测试](README.md)，写测试的完整步骤见其中的 [Use Case](README.md#use-case)。

## 完整门禁

```sh
pnpm gate [--changed [<base>]] [--test-name-pattern=<表达式>] [--test-shard=<序号>/<总数>] [<测试文件>...]
```

| 参数 | 作用 |
| --- | --- |
| 测试文件 | 只运行这些文件。省略时递归发现 `test/` 下的 `*.test.ts` 与 `test/e2e/` 下的 `*.e2e.ts` |
| `--changed [<base>]` | 只运行受改动影响的测试，选择规则见下文 |
| `--test-name-pattern=<表达式>` | 只运行标题匹配的测试 |
| `--test-shard=<序号>/<总数>` | 运行一个源码分片。分片分别作用于源码 Node 测试与浏览器测试，不含打包测试；所有分片的并集覆盖它们的完整集合，不保证与以往相同的分组 |
| `--test-shard=package` | 只运行打包测试，包括准备归档 |

`--changed` 的改动是 `<base>` 到 worktree 当前文件的全部差异，`<base>` 默认是 `origin/master` 与 HEAD 的 merge-base。它选中改动的测试文件，以及按下面的规则与改动有关的测试。改动了 `test/support/`、`scripts/`、`package.json` 或锁文件时，选中全部测试。

选择分两步。先找出改动涉及的 Spec 页面：改动的 Spec 文件，以及改动的源码文件在 `<base>` 与 worktree 两侧的代码声明指向的页面（删除的声明按 `<base>` 一侧计入）。页面按文件匹配，忽略锚点。再按页面选测试：

| 涉及的页面 | 选中的测试 |
| --- | --- |
| 一个 Use Case | 标记指向该 Use Case 的测试，以及标记指向它所属 Feature 或 Engineering 整体的测试 |
| 文档包内其它页面（README、cli、architecture 等） | 标记指向该 Feature 或 Engineering，或指向其中任一页面的测试 |
| 文档包外的项目规则与普通文档 | 不因此选中测试；`concord check` 仍完整执行 |

同一台机器上的门禁排队执行（[负载](README.md#共享资源与同步)）。退出 0 表示全部检查通过；非零表示违规、输入不完整或执行失败。Node 测试与浏览器测试互不阻止，任一失败使整体失败。给出文件或过滤条件时静态检查仍完整执行。

本地交付运行 `pnpm gate --changed`。推送到 master 后，CI 在 Instabox 的 `instabox-medium` 机器（4 vCPU、8 GiB）上运行：十六个分片各运行 `pnpm gate --test-shard=<序号>/16`，打包任务运行 `pnpm gate --test-shard=package`，并集是完整集合；每个任务一台新机器，代码只经 Git 推送到达，结果只经 CI 返回。失败由引入它的人立即修复。

报告写入每次调用独立的 `.test-results/run-*`，其中有按耗时排序的测试文件与子进程启动次数。CI 按分片上传报告。

`test/*.test.ts` 交给 Node test，`test/e2e/*.e2e.ts` 交给浏览器 runner。按文件执行与按标题过滤路由到相应 runner。

## 并发

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `CONCORD_TEST_CONCURRENCY` | Node 测试的文件进程并发上限，必须为正整数 | `min(8, floor(可用 CPU / 2))`，至少 1 |
| `CONCORD_E2E_WORKERS` | 浏览器测试的 worker 数 | `min(4, Node 并发上限, floor(准入池 × 0.6 / 浏览器预算))`，至少 1 |

两个变量只是上限，实际同时运行多少由内存准入决定。`MemoryMax` 是门禁的[内存上限](README.md#共享资源与同步)（[内存隔离](architecture.md#内存隔离)），减去固定开销后是准入池。浏览器 worker 从启动到退出占用浏览器预算；归档准备从开始到结束占用它的预算；每个 Node 测试文件从启动到它的全部后代进程退出，占用自己的预算。池中剩余不足时，后到的文件等待，不超额启动。本地与 CI 使用同一套规则。

| 类别 | 预算 | 依据 |
| --- | ---: | --- |
| 固定开销：门禁本身与静态检查 | 2 GiB | 不进入准入池；PSS 实测 1.85 GiB |
| 归档准备 | 2.5 GiB | PSS 实测 2.47 GiB（冷构建，六个部件都未命中） |
| 浏览器 worker：浏览器、View 服务、计算与操作进程、私有服务 | 2.5 GiB | 稳态 PSS 约 1.3 GiB；完整门禁中峰值 2.06–2.10 GiB（测试直接启动工作区服务后） |
| 打包测试文件：运行归档 CLI 的文件 | 3 GiB | PSS 实测 2.95 GiB |
| 其它 Node 测试文件，含全部后代进程 | 该文件上次的 PSS 峰值，没有记录时 2 GiB | PSS 实测 p50 0.22、p95 1.15、最大 3.05 GiB |

预算按完整进程树的 PSS 峰值向上取整到 0.5 GiB，不按单个进程计算。

普通 Node 测试文件的大小差别很大，统一预留会让准入池大半空着。门禁把每个文件本次的 PSS 峰值记在 worktree 外的用户缓存里，按文件路径区分；下一次该文件按记录取整后的值准入，最少 0.5 GiB。没有记录的文件（新文件、清空缓存后、CI 的全新环境）按 2 GiB 准入。记录只决定准入，不改变超预算的判定：超出 2 GiB 的文件仍在报告中列出。

PSS 把共享页按进程平摊，一棵树的 PSS 之和就是它实际占用的内存；RSS 之和会重复计入 Chromium 与 Node 进程间共享的页，不能作为预算依据。门禁的采样报告每棵树的 PSS 峰值，按 RSS 得到的历史数字在重测前只作上界参考。整个门禁的峰值除以 worker 数，不是单个 worker 的峰值。门禁报告列出实测峰值超过所属类别预算的文件，按超出[单文件上限](README.md#成本与稳定)处理：降低它的内存或建 Issue，不调高类别预算掩盖个别文件。

预算或默认值改变时，用同一冻结快照按[性能测量](../performance/README.md#测量方法)测量前后两种设置。在参照机器与 CI 的实际 `MemoryMax` 上，分别比较墙钟时间与内存峰值；失败或触及上限的运行不作为基线。

准入池容纳不下一个浏览器 worker 或一个打包测试文件时，门禁报告资源不足，不以“至少 1”的下限当作安全。

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
