---
format: concord.document/v1
id: issue-capability-audit
title: Issue 评论与生命周期入口核查
createdAt: 2026-09-27T08:22:46.418Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# Issue 功能核查与未完成边界

## 现有事实

源码 src/cli.ts 的 issue/feedback 命令、src/view-contract.ts 的 action union、src/documents.ts 与 web/pages/feedback.tsx 没有独立评论或 Issue reopen 入口。src/shared.ts 的 IssueSchema 只有 draft/closed、memoryRelations、adoptions、closure、source/origin 与 history。HistorySchema 没有评论作者/正文身份，也没有关闭裁决快照。将评论塞入作者正文或把正文编辑当作评论，会丢失独立记录语义。

src/feedback-schema.ts 的 RemoteFeedbackSchema/FeedbackSourceSchema 只存远端标题、正文、状态和观察时间；feedback-providers.ts 与 feedback-gh.ts 没有评论查询。当前缓存清理后保留首次导入快照，但该快照也不包含评论，不能声称有隐藏读取入口。

Web 已有来源和 pending/linked/closed 处理状态筛选。CLI list 没有筛选。已补 issue/feedback list 的 state/provider/triage/query 组合，新增受管 issue.list/feedback.list；Web 和 CLI 共用 matchesFeedback。state 是 draft/closed，处理状态是派生视图，不引入 open/in-progress 新状态。

## 必须保留的生命周期约束

close 检查关联 Problem 不得为 captured/open；关闭后不能添加关系。remove 只允许无来源、关系、closure和history的本地draft。reopen 若删除当前closure，必须先完整保留其证据、目标和引用，而不是仅保留关闭理由。若添加历史closure，还需明确Trace对历史引用的派生规则，不能丢失来源。

## 未定案方案

本地 Issue owner 中独立有序 comments 记录 id/author/createdAt/body；作者是本地声明标签而非认证身份，时间与ID由受管服务生成。追加要求 expectedDigest、严格有界Schema、原子publish及dry-run，保留作者正文/source/history；读取不依赖全局Trace。不提供编辑删除，不向远端发送。重开只能closed到draft，以专属历史事件保留完整closure，再移除当前closure，保留其它历史关系，重新关闭仍满足Problem门禁。该方案尚未实施，也不是已采用契约。

独立持久格式挑战通过 Herdr 启动 Claude Code Opus 5.5 只读review（issue-review-sep27，w4W:p45）；实际返回 HTTP 402「客户端: concord 渠道: aws-q 无有效套餐或余额不足」，没有审查结论。父会话按 C-007.3 和 AGENTS 重大设计挑战规则保留未定案；未换用其它模型或内置子agent；review pane已关闭，无本轮pane/tab/worktree残留。

## 未完成

追加/读取本地评论、CLI/Web评论UI、reopen及关闭裁决历史扩展，需要可用的指定独立review完成定案。远端评论读取还需有界分页、身份校验、首次导入与缓存观察语义的明确设计；没有发送任何远端评论或运行真实同步。当前close仅支持通用closed；Schema声明的fixed/delivered/duplicate等裁决没有对应完整受管入口，关联移除/退役也尚未提供，本轮不通过直接metadata写入绕过。
