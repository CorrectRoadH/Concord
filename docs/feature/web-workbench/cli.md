# CLI 与 Web 操作对应

启动输出区分实际监听的 `Host` / `Port`、本机浏览器 `Local` 地址和网卡 `Network` 地址。通配监听会列出各个适用网卡地址；仅绑定回环时不展示局域网入口。网卡地址是访问候选，不代表防火墙或 NAT 已放通。

| 能力 | CLI | Web |
| --- | --- | --- |
| 启动工作台 | `view --host <host> --port <port>` | 直接打开与项目导航 |
| 项目完整快照 | `workspace show --json` | 概览、列表、搜索 |
| 创建契约 | 各类型 `create` | 对应入口的创建表单 |
| Use Case | `use-case create --feature <ref>` | 所属 Feature 内创建 |
| 正文与页面 | `author set`、各包 `page add/show/set` | 富文本与源码编辑 |
| 作者字段、源码、配置 | `action --input <file|->` | 详情、源码、设置表单 |
| 生命周期 | `memory`、`issue`、`design decide`、`roadmap adopt` | 对应记录的操作表单 |
| 测试与证据 | `test run/evidence` | 测试、运行及证据页 |
| 注释辅助 | `code annotate`、`test annotate` | 代码与测试声明助手 |
| Git 变化 | `git status`、`git diff <path> --area staged|unstaged|untracked` | Git 面板 |
| 多来源反馈 | `feedback`、`issue link` | 反馈列表、来源、连接与本地笔记 |
| 检查与恢复 | `check`、`doctor`、`cache`、`recover` | 检查与设置 |
| 审阅、模板 | `review render`、`template list/show` | 审阅与模板操作 |

结构化 `action` 请求用 `action` 字段选择操作，例如 `document.set`、`source.set`、`config.set`。所有更新仍执行原有领域校验；摘要冲突需要重新读取并合并，不提供强制覆盖选项。高级原生证据入口执行同一最低证明要求，不能由通用 command 操作绕过。
