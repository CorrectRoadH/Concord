---
format: concord.document/v1
id: evolve-constitution
title: 功能开发遵守并修订项目宪法
createdAt: 2026-09-14T13:53:34.662Z
kind: use-case
feature: docs/feature/project-onboarding/README.md
---

# 功能开发遵守并修订项目宪法

## 用户目标

实现功能时遵守项目共同规则，并将新发现的通用约束沉淀为可追溯的宪法修订。

## 完整路径

1. 规划读取 docs/constitution.md，标出适用条款。
2. 设计和实现遵循条款；发现冲突时明确报告。
3. 新规则说明适用范围、正文、理由及来源 Feature、Design 或 Memory。
4. 按项目治理约定审阅具体修订和受影响范围，采用后更新版本与日期。
5. 实现和审阅重新读取当前宪法，检查受影响功能；已有审阅不得自动成为新版本的合规证明。

## 可观察验收

宪法始终只有一个正文来源；引用有稳定目标，删除或变更能诊断。功能专属参数等细节保留在 Feature。新增规则不得静默覆盖冲突旧规则。结构检查与语义审阅明确区分，Concord 不伪造自动合规结论。旧项目补齐宪法和治理写入协议须先完成设计裁决。

## 契约来源

[目标与范围](../README.md)。实现与验收状态见 Feature；测试关系从真实声明派生。
