# LSP 集成

## L1: 不在 Concord 进程内运行项目代码或新增原生模块

Concord 维护代码采用严格 TypeScript 与 Effect，原生例外只有 `native/hawdb`（[C-005](../../constitution.md#c-005)）。tree-sitter runtime、语法与查询必须按维护归属和分发方式判断；本设计不修订 C-005，包含其 WASM 运行路径的候选不可选。

## L2: 静态命令不启动外部分析进程

只有显式 `code analyze` 启动 language server。`check` 不读取分析观察；`trace`、`code list`、`review`、`test run` 和编辑器服务不启动 server。其它只读入口可以附带观察，但不能用它授权关系完整性或当前事实有效性。

## L3: 分析结果只是投影

符号定位、调用观察与相关性均使用共同 `Observation<T>`，只进入 HawDB。历史结果明确显示输入、时间与完整性；缺失、损坏与清空不改变源码关系或关联身份，不用于 Memory fixed（[C-001](../../constitution.md#c-001)、[C-004](../../constitution.md#c-004)）。

## L4: 外部进程资源归 Concord 管理

分析使用既有 runner 所有权与清理协议。捕获输入后释放来源句柄，再运行外部程序；清理完成后重新核验输入，短协调发布投影。超时、预算、取消和清理未知有具名结果；清理未知阻断发布（[C-013](../../constitution.md#c-013)）。

## L5: 编辑器服务只读且不开网络端口

编辑器服务只通过 stdio 通信，不写 owner，不提供编辑、格式化或执行命令能力。外部 server 发起的编辑与命令执行请求也明确拒绝，不读取或输出凭据（[C-003](../../constitution.md#c-003)、[C-012](../../constitution.md#c-012)）。

## L6: TypeScript 代码声明保持现有规则

TypeScript 与 JavaScript 使用内置编译器，声明有效性、范围及现有派生代码引用保持不变；可选调用观察不重写身份（[C-009](../../constitution.md#c-009)）。

### 候选

[LSP client](plans/lsp-client/README.md)：显式分析提供正向调用观察与符号定位。

[tree-sitter](plans/tree-sitter/README.md)：固定随包语法提供静态符号；需 C-005 修订，保留为未选候选。
