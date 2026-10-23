---
format: concord.document/v1
id: trace-show-first-run-pending
title: 首次运行 trace show 直接返回 QueryPending
createdAt: 2026-10-23T03:12:31.363Z
kind: issue
state: draft
memoryRelations: []
adoptions:
  current: []
  history: []
history: []
---

# 首次运行 trace show 直接返回 QueryPending

## 观察

在新接入的仓库里第一次运行 `concord trace show <path>`（不带 `--fresh`），命令退出 1，返回 `QueryPending`，`details.refresh` 为 `requested`。加 `--fresh` 后正常返回。

agent 按 skill 的建议在会话开始时运行 `trace show`，第一次调用就会失败，需要读懂错误再重试。

## 复现

`concord init` 后创建一份 Feature，运行 `concord trace show docs/feature/<id>/README.md`。

## 调查结果

在隔离 Git 消费仓库中，以构建后的公开 CLI 执行 `init --docs-only --yes` 并创建 `probe` Feature。首次执行以下三个独立查询均退出 1，JSON 错误为 `QueryPending`，`details.refresh` 为 `requested`：

```text
concord --json trace show docs/feature/probe/README.md
concord --json review render probe
concord --json trace gaps
```

`src/cli.ts` 的 `withReadRepo` 在查询携带 Query 参数且没有 `--fresh`、`--dry-run` 时调用 `cachedQuery`。trace show、trace gaps 与 review render 都提供这个参数，因而共享首次无快照行为。

`src/query-cache.ts` 的 `cachedQuery` 先通过 `queryContext` 确定身份并读取投影，再启动 detached `query-refresh-worker.js`。随后若没有 `observed.record`，就在此函数抛出 `QueryPending`，提示使用 `--fresh`。这是读取时的观察；函数没有等待后台扫描完成后重读快照。数据库读取暂不可用的 500ms 重试与首次构建等待不同：读取不可用或启动失败也可能先返回各自错误，并非所有没有快照的情况都统一为 QueryPending。

查询键包含 worktree、完整查询参数、配置字节与安装实现身份。因此，某个 trace show 已有快照不代表 review render 或 trace gaps 也有快照；清理缓存、查询目标变化或实现变化也可能再次出现首次状态。`src/query-refresh-worker.ts` 合并同键请求，在刷新上限内等待并扫描，后台进程可在前台退出后继续。

`--fresh` 绕过 `cachedQuery`，通过当前来源的 `withRepo` 读取并等待扫描，执行原有来源一致性与完整性校验；这个入口不写入异步完整查询投影，因而不能保证后续普通查询立即命中。`--dry-run` 同样绕过后台刷新。

## 与现行契约的关系

[异步诊断投影](../feature/local-data-engine/use-case/query-asynchronous-projections.md) 明确声明：三类命令立即读取最近完成的投影并请求后台刷新；首次无缓存返回 QueryPending、退出码 1；`--fresh` 等待当前来源；普通查询进程不执行全量扫描。冷缓存只报告构建状态，600ms warm 预算针对已有可读投影。当前观察符合这些声明，不能仅凭首次非零认定实现违反契约。

## 待判断的选项

1. **无快照时等待当前来源。** 可让首次查询直接返回诊断结果，减少 agent 的错误处理与重试。需要明确是等待后台同键刷新还是采用当前来源扫描；前者需定义等待上限、刷新失败与超时输出，后者改变普通查询进程不扫描的职责边界。还需决定首个结果是带历史性标记的投影还是当前来源结果，并同步修订首次 QueryPending/退出码、冷缓存性能与打包 CLI 验收约定。已有快照仍可保持立即读取与后台刷新。不能只删除 QueryPending 分支而保留未定义的首次等待语义。
2. **保留现有行为并文档化 `--fresh`。** 保持异步查询职责、首次 QueryPending/退出码 1、历史投影标记与现有性能边界。skill 与 local-sdlc CLI 的首次调用示例可以明确使用 `--fresh`，并说明普通调用须处理 QueryPending、后台完成后重试；`--fresh` 成功不等于已预热该查询键。此选项不改变 async projection 契约，但需要使入门示例准确表达首次调用成本和错误处理。

两种选项均未采用。本次仅调查并记录，不修改命令行为、Feature/Design 契约或 skill。
