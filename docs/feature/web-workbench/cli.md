# CLI 与 Web 操作对应

启动输出区分实际监听的 `Host` / `Port`、本机浏览器 `Local` 地址和网卡 `Network` 地址。通配监听会列出各个适用网卡地址；仅绑定回环时不展示局域网入口。网卡地址是访问候选，不代表防火墙或 NAT 已放通。

| 能力 | CLI | Web |
| --- | --- | --- |
| 启动工作台 | `view --host <host> --port <port>` | 直接打开与项目导航 |
| 当前项目完整快照 | `workspace show --json` | 定向当前读取提供编辑前像 |
| 工作区历史结构投影 | `workspace projection --json` | 概览、列表、搜索 |
| 创建文档 | `new <类别> <名称>` | 对应入口的创建表单；Use Case 在所属 Feature 内创建 |
| 读取文档 | `show <路径或选择器>`、`list [类别]` | 分类列表与详情 |
| 正文与页面 | 直接编辑文件 | 富文本与源码编辑 |
| 元数据、源码、配置 | 直接编辑文件，或 `action --input <file|->` | 详情、源码、设置表单 |
| 生命周期 | `issue`、`memory`、`design decide/defer`、`roadmap adopt`、`constitution adopt/amend` | 对应记录的操作表单或结构化 action |
| 测试与修复核验 | `test list/run/verify` | 测试与运行页 |
| 声明辅助 | — | 代码与测试声明助手生成可粘贴的注释 |
| Git 变化 | `git status`、`git diff <path> --area staged|unstaged|untracked` | Git 面板 |
| 多来源反馈 | `feedback`、`issue link` | 反馈列表、来源、连接与本地笔记 |
| 检查与恢复 | `check`、`doctor`、`cache`、`recover` | 检查与设置 |
| 审阅 | `review render` | 审阅 |

结构化 `action` 请求用 `action` 字段选择操作，例如 `document.set`、`source.set`、`config.set`。所有更新执行同一领域校验；摘要冲突需要重新读取并合并，不提供强制覆盖选项。`document.set` 拒绝的内容见[自动保存](README.md#自动保存)。

## 工作区投影

`workspace show --json` 扫描当前来源后返回。`workspace projection --json` 是[历史投影](../../constitution.md#c-014-4)：只读 Web 使用的同一缓存记录，输出 `{ operation: 'workspace-projection', snapshot, projection }`，不扫描、不启动刷新或后台进程（[决策依据](../../design/workspace-projection/DECISION.md)）。

`snapshot` 是不含任何正文的导航结构，`projection` 字段为：

| 字段 | 含义 |
| --- | --- |
| `status` | `ready`、`refresh-failed`（最近刷新失败，展示旧代次）或 `blocked`（最近刷新因 RecoveryRequired 阻断） |
| `current` | 恒为 `false`；结果不表示当前来源有效，不授权写入、check、fixed、恢复或证据裁决 |
| `builtAt`、`builtFrom`、`builtUntil` | 构建区间 |
| `consistent` | 构建期间来源无漂移 |
| `complete` | `consistent` 且扫描完整、无 finding |
| `changedPaths` | 构建期间变化的文件或目录，排序去重；`.` 表示影响范围未知 |
| `unknownRelations` | 等于 `!complete`；为 true 时缺失关系、零 finding 都表示未知，不表示无问题 |
| `refreshOwner` | `active` 或 `none`；没有 View 服务时为 `none` |
| `lastAttempt` | 可选，保留旧一致代次时最近尝试的时间、完整性与变化路径 |
| `lastError` | 可选，`failedAt`、具名 `code` 与至多 4096 字符的 `message` |

| 错误 | 条件 | 退出码 / HTTP |
| --- | --- | --- |
| `WorkspaceProjectionPending` | 当前身份尚无可读代次 | 1 / 202 |
| `RecoveryRequired` | 尚无代次且最近刷新被中断发布阻断 | 1 / 503 |
| `WorkspaceProjectionUnavailable` | 原生模块缺失、缓存损坏或无法安全读取、记录超过 8 MiB、身份无法计算；`details.reason` 给出原因码，如 `HawdbBusy`、`WorkspaceProjectionOutputLimit` | 1 / 503 |
| `CleanupFailed` | 仅 HTTP：尚无代次且 View 无法确认刷新进程清理 | — / 409 |

worktree、配置原文或安装产物变化后旧代次不再展示，先报告 Pending。

`GET /api/workspace`（无查询参数）返回同一 `{ snapshot, projection }`，`ETag` 为响应摘要，匹配时 304；HTTP 由工作区服务托管，读取不与其它进程争用缓存。`workspace projection` 在有同安装身份的服务时向服务读取，否则直接读取持久行，遇 `HawdbBusy` 在 500 ms 内重试，仍占用则不可用。GET 不申请刷新。`POST /api/workspace` 只接受 `{}`，沿用 Host/Origin 与 JSON 检查，申请一次刷新后返回 HTTP 202 `{ ok: true, value: { status: 'requested' } }`，不等待扫描、不读来源，原生不可用或清理失败时返回对应错误。

## PR 静态预览导出

```sh
concord view export --base <ref> [--head <ref>] [--base-label <label>] --out <new-directory> [--json]
```

`--head` 默认 `HEAD`，`--base-label` 默认等于 `--base`。成功输出 `{ operation: 'view-export', output, comparison, files }`，`files` 为条目数；比较与产物见[变更审阅](change-preview.md)。

| 错误 | 条件 |
| --- | --- |
| `PreviewShallowRepository` | 仓库为 shallow |
| `PreviewGitFailed` | ref 无法解析、对象缺失或 Git 失败 |
| `PreviewMergeBaseAmbiguous` | 没有或有多个最佳共同祖先 |
| `GitPathEncodingUnsupported` | 变更路径不是有效 UTF-8 |
| `PreviewBudgetExceeded` | 超出任一[导出预算](change-preview.md#预算) |
| `PreviewGitTimeout` | 单个 Git 进程超过 10 秒 |
| `PreviewGitInvalid` | Git 输出不完整或不可解析，或对象格式不受支持 |
| `PreviewUnsafeOutput` | 输出为仓库根、Git-private 路径或祖先不是真实目录 |
| `PreviewOutputExists` | 输出目录已存在 |
| `PreviewOutputChanged` | 写入期间输出目录或祖先被替换 |
| `PreviewAssetsInvalid` | 安装包内的阅读器资源缺失或超出发布预算 |
| `PreviewPublicationFailed` | 写入失败；不完整输出保留在 `details.output` |
| `PreviewExportFailed` | 整体超过 120 秒或其它导出失败 |
