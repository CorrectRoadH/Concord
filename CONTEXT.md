# Concord

Concord 管理产品契约、实现关联、测试声明与工程记忆之间的关系。

## Language

**Feature（功能契约）**：已采用的产品目标与行为约定。它说明要交付什么，不等同于实现已经完成。

**Use Case（使用场景）**：属于一个 Feature 的具体用户路径及其预期结果。

代码归属声明（Code Declaration）由 [代码命令入口](src/code-commands.ts) 和 [源码归属 Use Case](docs/feature/local-sdlc/use-case/trace-code-ownership.md) 定义。避免使用“覆盖率”“完成状态”“测试证据”指代这一关系。

**测试声明（Test Declaration）**：具有明确身份、目标契约和可选回归问题关联的真实测试定义。代码归属声明与测试声明各自表达自己的事实。

**反馈（Feedback）**：待理解和处理的用户报告、需求或建议，可以来自本地记录或外部系统。反馈不是已经确认的工程问题，也不代表要交付的功能。

**来源连接（Feedback Connection）**：对一个外部反馈系统及其接入范围的选择。同一个系统可以有多个独立的来源连接。

**外部状态（Remote State）**：来源系统对反馈的当前标记。它与 Concord 的本地处理状态、Memory 的工程结论分别表达不同事实。

**本地处理状态（Local Triage）**：Concord 对反馈是否待关联、已关联或已关闭的判断。多条反馈可以关联同一个 Memory 或 Feature，关联不等于合并原始报告。
