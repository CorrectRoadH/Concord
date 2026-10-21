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

## 配置与结果

`languageServers` 每项声明 `id`、`languageId`、完整后缀 `extensions`、`argv`、仓库内 `cwd`、`initializationOptions`、`implementationFiles`、`sourceFiles`、`profile` 与 `budgets`。`typescript` 是内置分析器的保留 ID。ID 与扩展后缀不得重复或重叠，不接受 JS/TS 后缀。`cwd: '.'` 表示仓库根。

`profile` 声明 `version`、固定 `serverVersion`、`commentPrefixes`、LSP `declarationKinds`、`symbolShape`。符号形态为 `document-symbol`；其它字段包括 `decorators`、`leadingComments`、`readiness` 与 `positionEncodings`。注释前缀只接受 `#`、`//`、`--`、`;`；装饰器策略为 `none` 或 `at-line`，不加载项目解析脚本。

就绪策略为 `none` 或带 `token` 的 `progress`；无可验证信号时保留 `IndexReadinessUnknown`。位置编码接受 UTF-16、UTF-8 与 UTF-32；server 未选择时按 UTF-16 校验，双方必须明确支持所用编码。

`implementationFiles` 至少声明一个真实入口，并包含脚本、插件和依赖锁。显式输入缺失时返回 `AnalysisInputUnverified`，server 未确认固定版本时也拒绝发布。`environment` 只允许显式选择 PATH、LANG、LC_ALL、TZ、TMPDIR 与 SYSTEMROOT；凭据不传递给 server。

观察返回输入摘要、分析器与 profile、时间、`current`、`complete` 和 `gaps`。调用观察始终保留 `OpenWorldCalls`；文件级归因保留 `FileScope`。未核验的 SDK、外部环境与私有索引保留 `UnverifiedEnvironment`。LSP 无法核验的动态派发、子进程与协议边界分别保留 `UnknownDynamicDispatch`、`UnknownSubprocessBoundary` 与 `UnknownProtocolBoundary`。静态读取不启动 server，缺失、损坏与陈旧观察不影响源码关系。

JS/TS 依赖观察跟随已捕获范围内的静态 import 与 re-export。动态 import、未解析模块、网络、子进程、深度和节点上限分别形成缺口；文件依赖不证明该文件每个测试都调用实现。

只有显式 `code analyze` 执行受信 server。分析器拒绝编辑和执行请求，进程组清理不能代替文件或网络沙箱。server 自行改写输入时返回 `AnalysisSourceChanged`；超时、取消或清理不确定时不发布新观察。

`current` 表达仓库内输入一致性；复核通过的 LSP 观察为 `current: true`，可用于符号定位与相关性判定。仓库外 SDK、外部环境与私有索引无法核验时保留 `UnverifiedEnvironment`，`complete` 为 false。仓库内输入变化后，旧观察只作历史展示。
