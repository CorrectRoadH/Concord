---
relations:
  - role: spec
    target: docs/feature/cross-platform-release/architecture.md#复用
---
# 标签发版失败后没有自动重试

## 观察

标签工作流用 `GITHUB_TOKEN` 调度 Release。v0.15.0 的 Release 运行 42435757015 首次失败后，“Retry release stage”没有产生任何运行：GitHub 不会因 `GITHUB_TOKEN` 产生的运行触发 `workflow_run`。手动调度的 Release 失败时，重试工作流能正常触发。

## 期望行为

标签发版失败的任务按 Spec 自动重试一次，与手动调度的 Release 一致。

## 复现

推送版本标签，让 Release 中任一任务失败，查看 retry-release.yml 是否针对该运行出现。
