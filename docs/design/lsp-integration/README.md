---
format: concord.document/v1
id: lsp-integration
title: LSP 集成
createdAt: 2026-10-21T07:36:07.468Z
kind: design
alternatives:
  - lsp-client
  - tree-sitter
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-009
  - docs/constitution.md#c-010
  - docs/constitution.md#c-012
  - docs/constitution.md#c-013
decision:
  selected: lsp-client
  reason: 显式 code analyze 取得符号定位与正向调用观察，源码标记始终拥有关系，不修订 C-005；编辑器服务只读并与分析进程分离
  at: 2026-10-21T09:28:47.185Z
  targets:
    - docs/feature/local-sdlc/use-case/analyze-other-languages.md
    - docs/feature/local-sdlc/use-case/use-editor-service.md
---

# LSP 集成

## Problem

多语言代码声明需要可从源码重建的关系，以及与语言相关的符号定位。调用层级可以补充测试与实现之间的正向观察，却不能证明完整调用图。编辑器还需要在未保存的跨文件修改中提供一致的契约跳转与诊断。

## Core Mental Model

- 关系来源与身份遵守[共同身份与观察结果](../test-journey-steps/共同身份.md)。代码关联由声明拥有，符号位置只是可选定位信息。
- 分析采用共同 `Observation<T>`；只有显式 `code analyze` 启动 language server，生成符号定位与正向调用观察。
- 相关性只报告 `observed` 或带 `gaps` 的 `not-observed`，不输出测试与行为无关的结论，也不生成 finding。
- `concord lsp` 提供只读编辑器服务，以带版本的 overlay 解析打开文档及其依赖，不隐式分析。

## Scope and Tradeoffs

[LSP client](plans/lsp-client/README.md) 通过受信外部程序提供定位与调用信息。它不提供完备性保证；非 TypeScript 关系始终从标记重建，没有当前符号观察时定位到标记行。TypeScript 与 JavaScript 保持现有声明与派生引用规则。

[tree-sitter](plans/tree-sitter/README.md) 是固定语法与查询的静态符号候选，需要修订 C-005 才可选。本设计不采用该修订，不把第三方 WASM 自动视为许可或禁用的依据。

静态符号层与 LSP 可以组合，但包含 tree-sitter 的组合同样需要 C-005 修订。调用完备性仍不成立，故不增加独立组合候选。编辑器服务、源码关系扫描与显式调用观察是可分别验收的能力。

## Contract Boundaries

步骤格式、测试 v1 关联身份、原生选择、原生标签与收据规则只引用[共同契约](../test-journey-steps/共同身份.md)。LSP 不改变测试 ID，不签发收据，不以符号或原生标签新增关系。

`check` 的退出码、finding 与 `complete` 不读取观察结果。`trace`、`review` 与工作台可附带明确标识的历史观察，但关系完整性独立从源码确定。C-011 第 3 款的拟议条文由 [test-adapters](../test-adapters/README.md) 拥有；本设计不执行宪法修订。

## Entry Points

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [Decision](DECISION.md)
- [LSP client](plans/lsp-client/README.md)
- [tree-sitter](plans/tree-sitter/README.md)
