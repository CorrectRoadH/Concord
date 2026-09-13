---
format: concord.document/v1
id: recover-local-state
title: 保护并恢复本地状态
createdAt: 2026-09-13T11:00:36.514Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 保护并恢复本地状态

## 场景

作为并行编辑仓库的维护者，我希望 Concord 写入不会越出 worktree、覆盖未知改动或在中断后静默留下半套事实。

## 主流程

1. mutation 在加锁后验证 canonical relative path、symlink 组件和完整 preimage。
2. 规划的全部变更写入绑定 projectId、root 与 privateDir 的 journal。
3. 文件逐一原子发布；成功提交后再刷新可重建缓存。
4. 中断后 `recover` 仅在每个文件匹配 preimage 或 planned digest 时回滚或完成；未知内容要求人工裁决。

## 验收

- traversal、绝对路径、symlink 逃逸和并发 writer 被拒绝。
- dry-run 走同一规划校验但不写 owner、journal 或缓存。
- recovery conflict 保留外部编辑；回滚恢复整个变更集和关系历史。
