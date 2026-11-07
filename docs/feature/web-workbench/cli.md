# CLI 与 Web 操作对应

启动输出区分实际监听的 `Host` / `Port`、本机浏览器 `Local` 地址和网卡 `Network` 地址。通配监听会列出各个适用网卡地址；仅绑定回环时不展示局域网入口。网卡地址是访问候选，不代表防火墙或 NAT 已放通。

| 能力 | CLI | Web |
| --- | --- | --- |
| 启动工作台 | `view --host <host> --port <port>` | 直接打开与项目导航 |
| 当前项目完整快照 | `workspace show --json` | 定向当前读取提供编辑前像 |
| 工作区投影 | `workspace projection --json` | 概览、列表、搜索 |
| 创建文档 | `new <类别> <名称>` | 对应入口的创建表单；Use Case 在所属 Feature 内创建 |
| 读取文档 | `show <路径或选择器>`、`list [类别]` | 分类列表与详情 |
| 正文与页面 | 直接编辑文件 | 富文本与源码编辑 |
| 元数据、源码、配置 | 直接编辑文件，或 `action --input <file|->` | 详情、源码、设置表单 |
| 生命周期 | `issue`、`memory`、`roadmap start` | 对应记录的操作表单或结构化 action |
| 测试与修复核验 | `test list/run/verify` | 测试与运行页 |
| 声明辅助 | — | 代码与测试声明助手生成可粘贴的注释 |
| Git 变化 | `git status`、`git diff <path> --area staged|unstaged|untracked` | Git 面板 |
| 多来源反馈 | `feedback`、`issue link` | 反馈列表、来源、连接与本地笔记 |
| 检查与恢复 | `check`、`doctor`、`cache`、`recover` | 检查与设置 |
| 审阅 | `review` | 审阅 |

`action` 从 `--input <file|->` 或 `--input-text <JSON>` 读取请求。`--input-text` 给不能提供 stdin 的调用方（例如 Herdr 的 `exec`）使用：可以重复，按出现顺序拼接成一份 JSON，因为单个命令行参数有系统上限（Linux 为 128 KiB）；与 `--input` 同时出现时返回 `InvalidInput`。只读的 `file.get {path}` 返回与 `GET /api/file` 相同的 `{path, body, digest}`，供不能连 HTTP 的调用方取得正文与编辑前像。结构化 `action` 请求用 `action` 字段选择操作，例如 `document.set`、`source.set`、`config.set`。所有更新执行同一领域校验；保存冲突需要重新读取并合并，不提供强制覆盖选项。`document.set` 拒绝的内容见[自动保存](ui.md#自动保存)。

## 工作区投影

`workspace show --json` 扫描当前来源后返回。`workspace projection --json` 是[历史投影](../local-data-engine/architecture.md#缓存与原生边界的约束)：只读 Web 使用的同一缓存记录，输出 `{ operation: 'workspace-projection', snapshot, projection }`，不扫描、不启动刷新或后台进程。

`snapshot` 是不含任何正文的导航结构，`projection` 字段为：

| 字段 | 含义 |
| --- | --- |
| `status` | `ready`、`refresh-failed`（最近刷新失败，展示上一份结果）或 `blocked`（最近刷新因 RecoveryRequired 阻断） |
| `current` | 恒为 `false`；结果不表示当前来源有效，不授权写入、check、fixed、恢复或证据裁决 |
| `builtAt`、`builtFrom`、`builtUntil` | 构建区间 |
| `complete` | 扫描完整、无 finding |
| `changedPaths` | 构建期间变化的文件或目录，排序去重；`.` 表示影响范围未知 |
| `unknownRelations` | 等于 `!complete`；为 true 时缺失关系、零 finding 都表示未知，不表示无问题 |
| `refreshOwner` | `active` 或 `none`；没有 View 服务时为 `none` |
| `lastAttempt` | 可选，保留上一份一致结果时最近尝试的时间、完整性与变化路径 |
| `lastError` | 可选，`failedAt`、具名 `code` 与至多 4096 字符的 `message` |

| 错误 | 条件 |
| --- | --- |
| `WorkspaceProjectionPending` | 当前身份尚无可读结果 |
| `RecoveryRequired` | 尚无结果且最近刷新被中断发布阻断 |
| `WorkspaceProjectionUnavailable` | 原生模块缺失、缓存损坏或无法安全读取、记录超过 8 MiB、身份无法计算；`details.reason` 给出原因码，如 `HawdbBusy`、`WorkspaceProjectionOutputLimit` |

这些错误退出 1。HTTP 入口的状态码映射见[工作区 HTTP 接口](api.md#工作区投影)。

worktree、配置原文或安装产物变化后旧结果不再展示，先报告 Pending。

`workspace projection` 在有同安装身份的服务时向服务读取，否则直接读取持久行，遇 `HawdbBusy` 在 500 ms 内重试，仍占用则不可用。

## PR 静态预览导出

```sh
concord view export --base <ref> [--head <ref>] [--base-label <label>] --out <new-directory> [--json]
```

`--head` 默认 `HEAD`，`--base-label` 默认等于 `--base`。成功输出 `{ operation: 'view-export', output, comparison, files }`，`files` 为条目数。输出目录的内容见 [PR 预览产物格式](format.md)，比较与发布的实现见[PR 静态导出](architecture.md#pr-静态导出)。

比较为 `merge-base(base, head)` 到 head，产物保留原始 base。导出不要求项目配置有效，不加载消费者配置或源码，不建立持久缓存，不联网。

`--out` 必须是父目录已存在的新目录，不能是仓库根、Git-private 路径或有 symlink 祖先。同一目标的并发导出只有一份成功。失败或取消保留不完整输出并在 `details.output` 报告路径，不删除、不覆盖。

### 导出上限

| 对象 | 上限 |
| --- | --- |
| entries | 2000 |
| 枚举 stdout | 2 MiB |
| 单个被比较 blob | 4 MiB |
| 两侧累计 blob 读取 | 64 MiB |
| 单个 patch | 2 MiB |
| Markdown 每侧 | 1 MiB |
| `changes.json` | 8 MiB |
| 每个 Git 进程 | stderr 64 KiB，10 秒 |
| 整个导出 | 120 秒 |
| 静态资源 | 单文件 10 MiB，总量 64 MiB，连同 `changes.json` 不超过 256 个文件 |

大对象即使 patch 很小也拒绝。超限、超时或取消不发布部分结果。

### 错误


| 错误 | 条件 |
| --- | --- |
| `PreviewShallowRepository` | 仓库为 shallow |
| `PreviewGitFailed` | ref 无法解析、对象缺失或 Git 失败 |
| `PreviewMergeBaseAmbiguous` | 没有或有多个最佳共同祖先 |
| `GitPathEncodingUnsupported` | 变更路径不是有效 UTF-8 |
| `PreviewBudgetExceeded` | 超出任一[导出上限](#导出上限) |
| `PreviewGitTimeout` | 单个 Git 进程超过 10 秒 |
| `PreviewGitInvalid` | Git 输出不完整或不可解析，或对象格式不受支持 |
| `PreviewUnsafeOutput` | 输出为仓库根、Git-private 路径或祖先不是真实目录 |
| `PreviewOutputExists` | 输出目录已存在 |
| `PreviewOutputChanged` | 写入期间输出目录或祖先被替换 |
| `PreviewAssetsInvalid` | 安装目录内的阅读器资源缺失或超出发布预算 |
| `PreviewPublicationFailed` | 写入失败；不完整输出保留在 `details.output` |
| `PreviewExportFailed` | 整体超过 120 秒或其它导出失败 |

### 校验产物

```sh
concord view verify <目录> [--json]
```

消费者在部署前用同一版本的 CLI 校验 `concord view export` 的输出目录。命令只读该目录，不需要项目目录，不运行 Git，不联网，也不读写缓存。

目录必须恰好含[输出目录](format.md#输出目录)列出的文件且没有 symlink，`changes.json` 按 [`concord.change-preview/v1`](format.md#changesjson) 严格解码，并在[导出上限](#导出上限)的 entries 与 `changes.json` 上限之内；解码规则与静态阅读器相同，Schema 由 `concord schema change-preview` 输出。

通过时退出 0，输出 `{ operation: 'view-verify', directory, comparison, files }`：`directory` 为绝对路径，`comparison` 原样取自 `changes.json`，`files` 为条目数。消费者据此核对 base、head 与 baseLabel；`comparison.mergeBase` 由消费者独立计算后比对，本命令不核对它与仓库是否一致。

```json
{
  "operation": "view-verify",
  "directory": "/home/ci/shop/concord-preview",
  "comparison": {
    "base": "5ae5556b04a9e27e2c6e56f47ac44aee01663bd5",
    "head": "f67b833a744dc75fe3c48057f75a887ff3f86fb8",
    "mergeBase": "5ae5556b04a9e27e2c6e56f47ac44aee01663bd5",
    "baseLabel": "master"
  },
  "files": 5
}
```

失败时退出 1，不修改目录：

| 错误 | 条件 |
| --- | --- |
| `PreviewDirectoryInvalid` | 目录不存在或不是真实目录，缺少或多出顶层条目，或含 symlink；`details.path` 给出出问题的路径 |
| `PreviewDataInvalid` | `changes.json` 不是 JSON、版本未知、含未知字段、违反字段约束或超出上限；`details.path` 给出字段路径，如 `entries[3].previousPath` |
