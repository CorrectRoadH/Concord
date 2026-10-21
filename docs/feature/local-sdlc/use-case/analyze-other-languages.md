---
format: concord.document/v1
id: analyze-other-languages
title: 分析其它语言的代码声明与测试依赖
createdAt: 2026-10-21T09:27:53.734Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 分析其它语言的代码声明与测试依赖

## 场景

作为多语言项目的维护者，我希望 Python、Go、Rust 等语言的实现代码也能声明契约关联，并看到测试依赖中是否观察到声明同一契约的实现。

## 主流程

1. 在非 JS/TS 源码的注释行写 `@concord-file`、`@concord-code`、`@concord-begin`、`@concord-end` 与 `@concord-implements`；注释前缀由 `languageServers[].profile` 声明。`check` 从源码重建这些关系。
2. 在 `concord.config.ts` 的 `languageServers` 中声明 language server。运行 `concord code analyze` 显式启动 server，取得符号定位与调用观察。JS/TS 测试的依赖观察由内置 TypeScript 编译器提供，不启动 server。
3. `code list`、`trace show` 与 `test show` 展示符号定位与相关性判定：`observed` 带层级，`not-observed` 带具名缺口。

## 验收

- 关系身份、观察结构与相关性判定遵守[共同身份](../../../design/test-journey-steps/共同身份.md)。`check` 不读取任何观察。
- 配置、符号绑定、调用观察、信任边界与分析生命周期见[采用设计](../../../design/lsp-integration/plans/lsp-client/architecture.md)。
- 输出中不出现"无关"结论；`not-observed` 的文字为"未观察到交集"并列出原因。
- 验收场景见 [CASES](../../../design/lsp-integration/CASES.md)。
