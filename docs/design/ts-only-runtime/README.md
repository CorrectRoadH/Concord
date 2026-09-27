---
format: concord.document/v1
id: ts-only-runtime
title: 仅静态 TS 的运行时与离线迁移边界
createdAt: 2026-09-14T15:25:32.984Z
kind: design
alternatives:
  - ts-only
  - runtime-compatibility
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-008
  - docs/constitution.md#c-009
decision:
  selected: ts-only
  reason: 仅接受 TypeScript 配置运行时；旧格式离线迁移，错误优先级、拒绝识别与 prepared-init 的例外由契约约束。
  at: 2026-09-14T15:33:25.190Z
  targets:
    - docs/feature/project-onboarding/README.md
---


# 仅静态 TS 的运行时与离线迁移边界

运行时只接受当前 TS 配置，旧项目通过显式离线迁移升级。离线迁移保留原始配置与事务现场。

普通运行时仅接受 concord.config.ts。旧 concord.json 仅用于检测与具名迁移诊断，不解析或发布为项目配置；存在双配置也要求迁移。旧 journal 不再恢复为当前授权，必须保存事务和锁现场，转交显式离线恢复。当前 TS 快照事务仍支持完整恢复。

一次性旧数据迁移由 scripts 拥有，不引入运行时 registry 或新增迁移 CLI。缺少当前配置绑定的旧证据不伪装为当前证明，重新取证；宪法、多来源 Memory、Note、Research observedAt 省略与 null 语义及共享 lease/journal 继续有效。

候选 ts-only 满足上述边界；runtime-compatibility 保留多个运行时授权模型，因此不采用。实现必须通过完整 gate 后交付。
