---
format: concord.document/v1
id: documentation-writing-import-acceptance
title: 文档检查迁入的初轮验收
createdAt: 2026-09-23T02:15:14.794Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# 文档检查迁入的初轮验收

2026-09-23 从 NiceEval acc9ab1c19129995043578768c22aa64cc197ab4 的 lint/docs/writing.ts 提取通用写作规则，在 Concord 添加独立检查入口。随后用户追加 Web 管理与本地知识工具，这份记录只描述追加功能之前的检查切片。

`pnpm check` 初轮发现新 Use Case 缺少实现关联，补齐真实注释后再次运行得到 217 项通过。它证明该候选的仓库检查，不证明后续变更或 NiceEval formal E2E。

将打包候选独立安装到临时目录，通过公开 CLI 指向 /home/ctrdh/.herdr/worktrees/NiceEval/repot-tool（HEAD b9d4f925d3fdfa56a213f622acae9d9724824d13）。消费仓库的 writing-rules.json 显式投影为临时 concord.writing/v1 政策；Resolve/resolve 两条因忽略大小写合并，保留两份替换说明与理由。产品 API 规则留在原消费者。

扫描 972 个 Markdown/MDX/SVG 文件得到 199 条现有诊断：禁词 95、句长 92、段长 12。这里没有声称消费者正文已经全部符合政策，也没有批量修改历史文档。另用临时正文验证了命中时退出 1、修正后退出 0。临时消费者政策和样本均已清理，Git status 回到干净。

父任务后续仍需验收最终 Web、工具治理和新增命令。原始初轮日志在本机 /tmp/concord-writing-check-final.log 与 /tmp/concord-writing-accept.YBGhDz；这些临时输出不是持久化 fixed evidence，也不能替代后续实际验证。
