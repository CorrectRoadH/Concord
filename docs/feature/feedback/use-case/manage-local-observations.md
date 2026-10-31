

# 无外部服务时管理本地观察

## 目标与来源

Local、GitHub、Linear 在同一反馈列表中作为三个来源呈现。Local 无需 connection、凭据或同步；其 Issue 正文与状态由本地 Markdown 拥有。GitHub/Linear 保存远端来源快照及本地调查笔记；不把本地编辑或删除投射成远端写入。

本地记录是 `docs/issues/<id>.md`，字段见[Issue 字段](../architecture.md#issue-字段)，不新增第二份 owner 或来源登记表。来源名称从 `source` 派生：没有 `source` 的记录为 local。

## 操作 Spec

- `concord new issue <名称>` 按模板创建 `status: open` 的本地 Issue；也可以直接创建文件。
- Issue 的正文与 frontmatter 可以直接编辑。`concord check` 校验当前字段；`concord check --since <base>` 校验本次变化中的状态转换：closed 必须带完整的关闭结论，新增或修改的 `verification` 按记录重放（[决策依据](../../../design/sdd-core-model/DECISION.md)）。Web 保存使用整文件摘要，只防止覆盖并发的外部编辑。
- `feedback list` 接受 `--status open|closed`、`--provider local|github|linear`、`--triage pending|linked|closed` 及 `--query`。筛选相交，空结果返回空列表；query 不区分大小写，匹配路径、名称、正文与已保存来源。`feedback.list` 受管操作使用相同筛选；Web 来源与处理状态筛选复用同一规则。筛选不读取远端网络，也不依赖无关 Spec 可解析。
- `list issue` 列出从当前 Issue 派生的[索引](../concepts.md#index)，`issue search <query>` [检索](../concepts.md#recall)匹配的 Issue 并返回原文与摘要。
- `issue link <id> --role <role> <target>` 按[角色表](../architecture.md#issue-字段)校验目标类型，省略 `--role` 时为 investigation；同一角色与目标去重，只接受 open Issue。adopts 的锚点使用 `check` 的同一校验。重复关系只由 duplicate 关闭的 `canonical` 写入。
- `issue unlink <id> --role <role> <target>` 删除这一项关系；删除 adopts 即退役该承接，历史在 Git。
- `issue close <id>` 以种类选项写入关闭结论，省略种类时为 closed。各种类的必需字段：
  - closed：`reason`。
  - fixed：`reason` 与 `verification`。命令先按[修复核验](../../local-sdlc/scope.md#证据的范围)核验，失败或无法核验时零写入。
  - delivered：`memory`、`target` 与至少一个 `proof`；`target` 必须是当前 adopts 之一。
  - duplicate：`canonical` 指向目标 Issue，是唯一的重复关系来源，不得成环。
  - declined：`memory`，指向 current 的 decision Memory。
  - invalid：至少一个 `evidence`。
  - external-fixed：`dependency`、`version` 与至少一个 `proof`。
  - duplicate、declined、invalid 关闭时 Issue 不带 adopts；仍有 adopts 时命令拒绝，先用 `issue unlink` 删除。proof 与 evidence 可以重复。写入与 `concord check` 共用关闭校验。
- `issue reopen <id>` 删除 `closure`，状态回到 open；closed Issue 先重开再关联。
- 直接删除 Issue 文件时，`check` 报告指向它的失效引用。Web 只对安全的本地 Issue 显示删除操作：没有 `source`、`origin`、`closure`、`relations`，Trace 也没有指向它或其锚点的关系；服务端独立执行这些限制，拒绝陈旧摘要，删除复用当前发布日志与恢复，不运行远端调用。其它来源和已进入调查或关闭的记录不显示可删除能力。
- 助手写入使用单文件发布 journal 与 `concord recover`；错误返回具名 JSON、退出 1，失败零写入。
- 关联只使用本地 Issue；不把来源接入实现成要求本地用户配置的虚假远端 connection。

## 验收

打包公开 CLI 在无任何 provider 配置的 Git 消费者中完成创建、筛选、直接编辑、link、unlink、全部关闭种类与 reopen，`concord check` 无 finding；dry-run 不改文件。

直接写入的 closed 缺少必需字段、delivered 的 target 不在 adopts、duplicate 成环、declined 指向非 current 的 decision Memory、fixed 没有 `verification`，分别由 `check` 报告。`check --since <base>` 报告非法状态转换与无法重放的 `verification`。

Web 删除时，关系、关闭结论、远端来源、入边引用与陈旧摘要分别拒绝；删除的 prepared 与 committed 恢复分别保留前像与已提交结果，未知编辑拒绝。HTTP 与真实浏览器验证本地来源与删除反馈；GitHub/Linear 保持只读接入。
