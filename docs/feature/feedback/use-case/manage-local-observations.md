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

- `issue create` 与现有 `issue draft` 创建本地观察；feedback create 继续有效。
- `issue index` 提供动态摘要索引，`issue recall <query>` 检索标题和正文并返回正文、当前摘要与来源；`issue show` 保持现有行为。
- `issue edit <id> --body <file> --expected-digest <digest>` 仅修改作者正文，保留来源、关系和生命周期；标题通过既有 document.metadata 操作修改。
- `issue remove <id> --expected-digest <digest>` 只允许删除尚未建立关系或历史的本地 draft：无 source、origin、closure、history、Memory 关系、当前或历史 Feature adoption，且 Trace 没有指向它或其 anchor 的关系。拒绝格式/关系不完整的仓库与陈旧摘要。删除复用当前发布日志与恢复，不运行远端调用。
- 已经进入调查或关闭历史的记录继续使用 close 和现有生命周期，不能删除来规避证据与历史。导入记录不提供删除远端对象的能力。
- Web 明确本地来源可直接创建、编辑与关联。安全可删除的本地草稿提供显式删除操作；其它来源和已进入调查的记录不显示可删除能力。服务端仍独立执行全部限制。
- Feature、Memory 关联复用当前命令；不把来源接入实现成要求本地用户配置的虚假远端 connection。

## 验收

打包公开 CLI 在无任何 provider 配置的 Git 消费者中完成创建、动态索引、recall、摘要更新、关联及安全删除。关联、历史、远端来源、陈旧摘要分别拒绝删除；dry-run 不改文件。删除的 prepared 与 committed 恢复分别保留前像与已提交结果，未知编辑拒绝。HTTP 与真实浏览器验证本地来源和删除反馈；GitHub/Linear 保持只读接入。
