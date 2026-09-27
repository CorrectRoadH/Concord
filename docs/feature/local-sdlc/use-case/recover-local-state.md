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
5. 恢复入口分别报告 journal 结果、实际回收的 publication token 和 runner 状态。初检发现 runner 清理未知时保留 journal 并返回 blocked；正常恢复后再次取得独占快照核验。完整字段与所有权规则见[协调架构](../../portable-coordination/architecture.md)。

## 验收

- traversal、绝对路径、symlink 逃逸和并发 writer 被拒绝。
- dry-run 走同一规划校验但不写 owner、journal 或缓存。
- recovery conflict 保留外部编辑；回滚恢复整个变更集和关系历史。
- 无 journal 不代表执行进程已清理。runner blocked 时 CLI 失败退出，Web 与 action 保留同一阻塞结果，普通只读观察仍可进行。
- init 回滚后的最终核验不要求配置文件仍存在；并发 owner 使最终核验 Busy 时不得报告恢复完成。
