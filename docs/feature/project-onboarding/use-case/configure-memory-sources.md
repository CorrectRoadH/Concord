---
format: concord.document/v1
id: configure-memory-sources
title: 配置和使用多个 Memory 来源
createdAt: 2026-09-14T13:53:35.522Z
kind: use-case
feature: docs/feature/project-onboarding/README.md
---

# 配置和使用多个 Memory 来源

## 用户目标

维护者在初始化时配置 Memory 后端与具体来源，明确读取范围与写入目标，未来能接入更多 provider。

## 完整路径

1. 首版默认提供项目本地文件来源；provider 只有本地文件时不展示虚假多选。
2. 添加或调整具体来源，明确名称、位置和读写能力。
3. 查询能辨认来源；新增与生命周期写入有明确目标。
4. 遇到重复身份、不可用来源、只读写入或非法路径时得到可解释结果。

## 可观察验收

配置必须驱动真实读取与写入，不能仅存储无效选项。不存在的 provider 明确拒绝。聚合读取不隐含多处同步写入。来源身份、路径范围、失败策略与 fixed 证据适用范围必须经设计裁决；外部来源不得自动借用当前项目证据关闭 Problem。

## 契约来源

[目标与范围](../README.md)。实现与验收状态见 Feature；测试关系从真实声明派生。
