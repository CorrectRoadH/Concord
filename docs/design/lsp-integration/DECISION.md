# LSP 集成

## Decision

Undecided.

## Rationale

候选比较以源码关系独立性、正向观察范围、文档版本一致性和宪法边界为依据。LSP 不提供调用完备性；tree-sitter 需要 C-005 修订，该修订不属于本设计采用范围。

## Rejected Options

无已裁决的排除项。

## Residual Risks

语言 server 的绑定能力、构建副作用与索引确定性依赖具体版本和环境。没有当前符号观察时只能定位到标记行；调用缺口不能成为行为无关的证明。
