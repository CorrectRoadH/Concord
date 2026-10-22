---
format: concord.document/v1
id: repository-process-adapter
title: 可靠原生证据的进程接入
createdAt: 2026-10-22T05:02:45.654Z
kind: design
alternatives:
  - process-bridge
  - module-host
constitutionRefs:
  - docs/constitution.md#c-004
  - docs/constitution.md#c-007
  - docs/constitution.md#c-010
  - docs/constitution.md#c-013
  - docs/constitution.md#c-015
decision:
  selected: process-bridge
  reason: 保留单一治理权威及正式证据门，通过进程接入消除消费者内部库耦合。
  at: 2026-10-22T05:17:37.684Z
  targets: []
---

# 可靠原生证据的进程接入

消费者通过版本化进程协议调用 Concord，不在 runner 中加载 Concord 的内部模块或 Effect 服务。
Concord 继续拥有声明身份、来源投影、证据格式与最终裁决；消费者继续拥有构建、安装、原生执行及资源终结。

本主题比较保留模块 host 与进程桥接。普通 test-adapter 的原生观察不升级为可靠性证明。

- [目标](GOALS.md)
- [约束](LIMITS.md)
- [验收场景](CASES.md)
- [进程桥接](plans/process-bridge/README.md)
- [模块 host](plans/module-host/README.md)
- [裁决](DECISION.md)
