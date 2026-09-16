---
format: concord.document/v1
id: maintain-project-config
title: 安全维护项目配置
createdAt: 2026-09-14T14:03:12.465Z
kind: use-case
feature: docs/feature/project-onboarding/README.md
---

# 安全维护项目配置

## 用户目标

维护者在初始化之后调整项目默认值与来源配置，获得 TypeScript 类型提示，并保持读取、编辑、验证和恢复行为一致。

## 完整路径

1. 仅读取 concord.config.ts；既有 concord.json 项目先显式离线迁移。
2. 使用静态 export default 对象表达配置；允许明确支持的类型语法，不执行消费者模块。
3. 通过公开配置读取入口取得正文摘要，再用相同前像提交配置修改。
4. 调整后新命令读取新配置；旧文档不被隐式重写。
5. 若发生写入中断，按冻结配置快照恢复；不依据外部新配置扩大权限。

## 可观察验收

双配置、非法运行时表达式、重复键与不安全路径明确拒绝且不执行消费者代码。CAS 使用同一次读取的 source，拒绝覆盖外部编辑；普通工具编辑可规范化 TS 全文件，但恢复必须逐字节还原。配置仅改变注释也会改变新证据绑定摘要，不改写历史证据。畸形配置和宪法缺失不应导致恢复覆盖未知内容。

## 契约来源

[采用方案](../../../design/onboarding-contracts/plans/compatible/README.md) 和 [治理格式与组合验收](../../../design/onboarding-contracts/plans/compatible/governance.md)。实现与验收状态见 Feature；测试关系从真实声明派生。
