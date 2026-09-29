# 工作区只读投影

## L1: owner-bytes-stay-out-of-cache

持久缓存不保存文件 owner 正文、配置原文、证据或发布日志。展示投影只保存派生导航、关系、摘要和诊断；正文通过安全的定向当前读取取得。依据 [C-001](../../constitution.md#c-001)。

## L2: current-authority

展示代次的 `complete`、`findings` 和摘要不得授权写入、check、fixed、恢复或证据裁决。草稿提交使用其建立时的当前来源摘要，冲突不覆盖外部编辑。依据 [C-003](../../constitution.md#c-003)、[C-004](../../constitution.md#c-004) 与 [C-013](../../constitution.md#c-013)。

## L3: compatible-cli

现有 `workspace show` 的当前来源含义及 JSON 结构保留；历史投影必须由显式入口选择。依据 [CLI 对应](../../feature/web-workbench/cli.md) 与 [C-007](../../constitution.md#c-007)。

## L4: bounded-ownership

同一 worktree 最多一个刷新 owner；持久数据严格解码并有容量上限。Web 关闭确认自己拥有的进程组清理；CLI 缓存入口只读，不启动后台进程。依据 [C-005](../../constitution.md#c-005)、[C-013](../../constitution.md#c-013) 和 [C-014](../../constitution.md#c-014)。

## L5: honest-completeness

来源前后不一致时不发布宣称当前且完整的结果。供导航使用的不完整代次必须标注构建区间、变化路径和 `complete:false`；未知关系不得显示为无问题。依据 [C-004](../../constitution.md#c-004) 与 [C-013](../../constitution.md#c-013)。

## L6: cache-only-workbench

Web 工作区读取只消费受管缓存。HawDB 不可用、缓存损坏且无法安全读取时返回具名不可用，不回退同步来源扫描；当前来源读取仍由显式 CLI 查询和定向编辑入口承担。依据本功能的单一路径要求及 [C-014](../../constitution.md#c-014)。
