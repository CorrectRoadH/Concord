---
format: concord.document/v1
id: plan-and-adopt-contracts
title: 规划并采用文档契约
createdAt: 2026-09-13T11:00:34.175Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 规划并采用文档契约

## 场景

作为功能负责人，我希望 Feature、Use Case、Roadmap、Design 与 Engineering 各自拥有清晰正文和 supporting pages，并能把已定稿 Roadmap 安全采用为当前 Feature。

## 主流程

1. Feature、Roadmap 和 Design 候选创建必需 README；作者用 --pages 选择 library、cli、architecture、lifecycle、use-case。Design 外层目标、限制、案例、裁决页始终生成。Engineering 从目标、机制、使用、验收开始，按需加专题页。
2. `page show` 返回正文与 digest；`page set` 只在 preimage 未变化时写入。
3. Design 只允许一次裁决；Roadmap adoption 复制实际 Markdown 集合、重写集合内安全链接并迁移当前 promotion。
4. 原 Roadmap 保留 adopted 历史，新 Feature 成为当前契约 owner。

## 验收

- 相同 kind 的重复 id、嵌套 owner、附件、symlink、目标冲突和不支持的链接均拒绝且不留下部分写入。
- supporting page 可被精确 path/anchor 解析到所属 Feature，但相邻 package 不混入。
- adoption 期间源集合或字节变化会阻止 publication。
