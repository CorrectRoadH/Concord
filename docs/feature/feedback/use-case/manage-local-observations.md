---
format: concord.document/v1
id: manage-local-observations
title: 无外部服务时管理本地观察
createdAt: 2026-09-23T02:08:49.900Z
kind: use-case
feature: docs/feature/feedback/README.md
---



# 无外部服务时管理本地观察

## 目标与来源

Local、GitHub、Linear 在同一反馈列表中作为三个来源呈现。Local 无需 connection、凭据或同步；其 Issue 正文与状态由本地 Markdown 拥有。GitHub/Linear 保存远端来源快照及本地调查笔记；不把本地编辑或删除投射成远端写入。

本地记录沿用 docs/issues/<id>.md 和现有 kind: issue，不新增第二份 owner 或来源登记表。来源名称从已有 source 元数据派生：没有远端 source 的本地记录为 local。持久化格式保持不变。

## 操作契约

- `issue create` 与 `issue draft` 创建本地观察。
- `issue list` 与 `feedback list` 接受 `--state draft|closed`、`--provider local|github|linear`、`--triage pending|linked|closed` 及 `--query`。筛选相交，空结果返回空列表；query 不区分大小写，匹配 ID、标题、正文与已保存来源。`issue.list`、`feedback.list` 受管操作使用相同筛选；Web 来源与处理状态筛选复用同一规则。筛选不读取远端网络，也不依赖无关契约可解析。
- `issue index` 提供动态摘要索引，`issue recall <query>` 检索标题和正文并返回正文、当前摘要与来源；`issue show` 保持现有行为。
- `issue edit <id> --body <file> --expected-digest <digest>` 仅修改作者正文，保留来源、关系和生命周期；标题通过既有 document.metadata 操作修改。
- `issue remove <id> --expected-digest <digest>` 只允许删除尚未建立关系或历史的本地 draft。条件是：无 source、origin、closure、history、Memory 关系、当前或历史 Feature adoption，Trace 也没有指向它或其 anchor 的关系。拒绝格式/关系不完整的仓库与陈旧摘要。删除复用当前发布日志与恢复，不运行远端调用。
- 已经进入调查或关闭历史的记录继续使用 close 和现有生命周期，不能删除来规避证据与历史。导入记录不提供删除远端对象的能力。
- Web 明确本地来源可直接创建、编辑与关联。安全可删除的本地草稿提供显式删除操作；其它来源和已进入调查的记录不显示可删除能力。服务端仍独立执行全部限制。
- `issue link <id> --memory <ref> [--kind investigation|root-cause|decision|delivery]` 默认 investigation，按 kind 与 Memory 去重，只接受 draft。
- `issue adopt <id> --to <ref>` 只接受 draft，目标是 Roadmap、Feature、Use Case 或 Engineering 的 exact owner ref；anchor 使用 check 的同一校验。基础加载不读取 concord.repository.json，也不要求 Trace 完整。
- `issue retire <id> --from <ref>` 移除当前采用，并把执行时 HEAD 写入历史；无提交返回 IssueRetireRequiresCommit，零写入。
- `issue close <id> --kind fixed|delivered|duplicate|declined|invalid|external-fixed|closed` 参数遵守 IssueClosureSchema。省略 kind 等同 closed，要求 reason；全部 kind 在存在 captured 或 open Problem 时返回 OpenProblem。fixed 要求 fixed Problem，declined 要求 current Decision，duplicate 要求无环 canonical Issue；duplicate、declined、invalid 要求先退役全部当前采用。写入与 concord check 共用闭合校验。
- `issue reopen <id> --reason <text>` 移除 closure 并追加历史；closed Issue 先重开再关联或采用。
- 本地写入使用单文件发布 journal 与 concord recover；错误返回具名 JSON、退出 1，失败零写入。
- Feature、Memory 关联使用 issue 命令；不把来源接入实现成要求本地用户配置的虚假远端 connection。

## 验收

打包公开 CLI 在无任何 provider 配置的 Git 消费者中完成创建、动态索引、recall、摘要更新、关联及安全删除。关联、历史、远端来源、陈旧摘要分别拒绝删除；dry-run 不改文件。删除的 prepared 与 committed 恢复分别保留前像与已提交结果，未知编辑拒绝。HTTP 与真实浏览器验证本地来源和删除反馈；GitHub/Linear 保持只读接入。
