---
format: concord.document/v1
id: onboarding-contracts
title: 初始化配置与项目治理契约
createdAt: 2026-09-14T13:53:56.667Z
kind: design
alternatives:
  - compatible
  - replacement
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-008
decision:
  selected: compatible
  reason: 独立 Astra CONDITIONAL 四项条件已落实到治理格式、anchor解析、恢复授权与组合验收定义。采用兼容演进，隔离 worktree 实施，未声明实现验收通过。
  at: 2026-09-14T14:00:13.281Z
  targets:
    - docs/feature/project-onboarding/README.md
---

> 历史裁决：其中旧配置、journal 和收据的运行时兼容规则已被 [TS-only 裁决](../ts-only-runtime/README.md) 替代；以下保留原设计记录。

# 初始化配置与项目治理契约

## 目标

实现 [渐进式项目初始化与宪法治理](../../feature/project-onboarding/README.md) 及其五条 Use Case。已采用 compatible；主仓库集成及打包验收已完成。

## 需要裁决的边界

- TypeScript 配置采用可执行模块还是严格静态对象；加载是否改变普通查询不执行消费者代码的边界。
- JSON 消费者的兼容、TS/JSON 同时存在的拒绝策略、配置编辑与 journal 恢复。
- Memory source 身份、允许的目录、聚合读取、默认写入和证据归属。
- 必需宪法的旧项目接入、修订身份和审阅失效规则。

## 候选

- compatible：保留既有 JSON 消费者，新 init 生成严格可解析的 TS 数据配置，不执行消费者代码；新增可选字段保留原有缺省语义。本地 Memory 来源限定消费者 worktree 内，明确单一写入目标与来源身份。通过显式接入补齐旧项目宪法。
- replacement：立即只接受可执行 TS 配置，迁移所有消费者，采用通用跨目录后端与统一来源身份。影响信任边界、历史引用与恢复，迁移和回滚成本更高。

## 裁决与验收

采用 compatible。静态 TS 不支持任意运行时模块。多来源保留现有 memory/<id>.md canonical 引用及 red/green 证据边界。既有项目缺少宪法时明确待接入，不隐式覆盖，也不阻断 recovery。

独立 Herdr design_grill 给出 CONDITIONAL，四项格式、锚点、恢复授权和组合验收条件已落实到 governance 后记录采用。集成 `pnpm check` 132 项通过，涵盖共享协调锁、迁移后的模型、配置恢复及宪法引用。
