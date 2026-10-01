---
format: concord.document/v1
id: coordinate-docs-work
title: 并行切分文档工作
createdAt: 2026-10-01T04:04:38.383Z
kind: use-case
feature: docs/feature/neutral-project-governance/README.md
---

# 并行切分文档工作

## 用户目标

父 Agent 在多人共享的工作树上，把已定稿的文档目标切成互斥写集交给不同 Agent，并用可重新执行的检查收据验收每份交付，最后由一个 finalizer 收尾。

## 完整路径

1. 项目可在 `concord.config.ts` 的 `docsWork` 中声明检查命令、finalizer 与共享路径；省略时使用写作检查与 `concord check`。run 期间修改该配置会使后续 check 与 finalize 拒绝。
2. 父 Agent 编写 `concord.docs-work-plan/v1`：每个 item 声明 goal、write（文件、目录或 glob）、read、blockedBy 与检查 ID。然后运行 `concord docs work prepare --plan plan.json --json`。只需单目录时可用 `--scope <path>`。
3. prepare 只要求声明的 read、write 与共享路径干净；声明范围外他人的未提交改动不影响结果。
4. 父 Agent 把 item 交给 Agent。Agent 完成后运行 `check <run> <item> --report`。
5. 父 Agent 独立核对 diff，用 `check <run> <item> --verify <digest>` 重跑检查。被依赖的 item 必须先 verified。
6. 全部 item verified 后运行 `finalize <run>`，执行配置的 finalizer。

## 结果

- 写集重叠、重复 item ID、写入共享路径、未声明依赖、依赖环、未知检查、范围内脏文件被聚合报告，零写入。
- read 集合在 check 时被他人修改返回 `DocsWorkReadChanged`。
- 检查失败的收据标记 failed；finalize 列出缺少 verified 收据、内容已变化或依赖在其后重新 verified 的 item，不运行 finalizer。
- verified 只说明声明范围内的内容通过了声明的检查。任何 item 都未声明的路径上的改动不被报告，由父 Agent 的 diff 验收负责。
- Docs Work 不启动、等待或关闭 Agent，也不合并 diff。

## 契约来源

- [Docs Work](../../../design/repository-workflows/plans/main-cli-owned/architecture.md#docs-work)
- [公开输出契约](../../../design/repository-workflows/plans/main-cli-owned/architecture.md#公开输出契约)
