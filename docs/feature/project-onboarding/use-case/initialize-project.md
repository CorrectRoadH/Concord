---
format: concord.document/v1
id: initialize-project
title: 渐进选择并初始化项目
createdAt: 2026-09-14T13:53:32.822Z
kind: use-case
feature: docs/feature/project-onboarding/README.md
---

# 渐进选择并初始化项目

## 用户目标

维护者从尚未接入的 Git worktree 顶层完成项目特点、文档、测试源码与 Memory 选择，得到可以继续维护的 Concord 项目。

## 完整路径

1. 运行 init，组合选择 Library、CLI 等项目特点，或保留通用默认值。
2. 创建必需的项目宪法；没有已采用原则时保留明确 draft，后续由作者显式采用为 active。独立选择是否生成 DESIGN.md，调整后续文档默认页面。
3. 确认测试根、源码根和 runner；无测试项目允许空测试根。
4. 配置 Memory 来源，首版仅选择本地文件 provider。
5. 预览配置与完整文件变更后完成；非交互输入能表达相同选择。
6. 运行 doctor，查看真实配置与待完善项。

## 可观察验收

- 新项目必有 docs/constitution.md；不将未填写原则或模板示例当成已采用规则。
- DESIGN.md 仅在选中时创建，已有文档保留。
- 取消、非法选项或文件冲突不得留下部分初始化；dry-run 不写项目文件。已有 owner 或锁文件的仓库预览必须遵守共享 lease 及两套 journal 障碍；无 owner、无锁的新仓库不创建私有状态。
- 非 TTY 不等待交互，结果确定；重跑不覆盖既有项目配置。
- 配置迁移的具体文件加载、冲突与恢复行为以设计裁决为准。

## 契约来源

[目标与范围](../README.md)。实现与验收状态见 Feature；本文描述用户契约，不替代执行证据。
