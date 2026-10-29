# 单一写法的术语由 Markdown 拥有

## L1: Scope and identity

目录与精确文件名决定作用域；概念身份为 catalog 路径加 ID，不重复维护索引，兄弟定义不泄漏（[C-001](../../constitution.md#c-001-2)）。

## L2: Publication and recovery

写入与恢复校验相同的路径、操作、解析结果、摘要与依赖，未知编辑被拒绝（[C-003](../../constitution.md#c-003)）。

## L3: Explicit transition

改变术语 owner 必须修订宪法；运行时只识别 `concepts.md`，不读取、检测或转换旧格式，旧来源由接入项目手动改写（[C-008](../../constitution.md#c-008)、[C-009](../../constitution.md#c-009)）。

## L4: Strict structure

术语来源的结构不合规时返回带行号的具名错误，不跳过、不猜测、不部分接受。
