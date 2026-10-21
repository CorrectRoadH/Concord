# LSP 集成

## Decision

Selected: [lsp-client](plans/lsp-client/README.md)

## Rationale

lsp-client 通过显式 `code analyze` 启动项目配置的 language server，取得符号定位与正向调用观察。源码标记始终拥有关系，观察只进入可丢弃投影，`check` 不读取观察。它满足全部 Limit，并且不需要修订 C-005。编辑器服务只读、使用 stdio，与分析进程分离。

G1: 非 JS/TS 的关系从源码标记重建，始终可用；准确的符号范围依赖语言 profile 与 server 版本的兼容证据，证据不足时只定位到标记行。

G2: 调用层级没有全程序完备性保证，观察始终 `complete: false` 并带 `OpenWorldCalls`。动态调用与黑盒边界保留为缺口。

G4: 在既有 profile 形态内新增语言只需配置；需要新的词法或绑定语义时仍要修改 Concord，这是避免执行项目代码的代价。

G5: 关系总能从源码重建；观察结果的重现受 server 与环境确定性限制，只在固定可复现环境中比较。

## Rejected Options

tree-sitter 在 Concord 进程内执行随包 WASM 语法，需要修订 C-005 的原生例外；它也不能提供跨文件调用信息，新语言必须随 Concord 发布。本 Design 不修订 C-005，因此未选。

## Residual Risks

- 各语言 server 的实际兼容性未验证；能力矩阵只在真实 fixture 证据之后宣称支持。
- server 是受信程序，可能在分析期间写文件或访问网络；输入前后复核只能拒绝发布，不能阻止副作用。
- 编辑器 overlay 的版本淘汰逻辑必须按 CASES C7–C9、C17 验收。
