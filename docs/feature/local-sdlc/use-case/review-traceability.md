---
format: concord.document/v1
id: review-traceability
title: 追踪契约并生成审阅材料
createdAt: 2026-09-13T11:00:37.386Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 追踪契约并生成审阅材料

## 场景

作为 reviewer，我希望从当前 Feature 或整个项目查看契约、supporting page、Use Case、测试、Memory 和证据之间的关系，以判断变更是否有可审阅的验收依据。

## 主流程

1. `trace check` 编译所有 owner 与测试正向关系，验证目标存在、类型、重复和循环。
2. `trace show <feature>` 仅聚合该 Feature、精确 supporting path/anchor 和所属 Use Case 的反向关系。
3. `review render [feature]` 生成本地 Markdown，列出当前契约、case、Memory、command evidence 及不可用状态。
4. reviewer 回到 owner 和测试源码核对正文；输出不自动发送 GitHub 或修改远端。

## 验收

- 相邻 Feature 不因目录前缀相似而混入。
- 删除、重命名或退役测试后，trace 立即反映当前源码。
- 缺少私有证据、unknown execution 和 command evidence 的边界在 review 中明确呈现，不伪造覆盖率。
