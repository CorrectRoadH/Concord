# Concord

Concord 管理产品契约、实现关联、测试声明与工程记忆之间的关系。

## Language

**Feature（功能契约）**：已采用的产品目标与行为约定。它说明要交付什么，不等同于实现已经完成。

**Use Case（使用场景）**：属于一个 Feature 的具体用户路径及其预期结果。

代码归属声明（Code Declaration）由 [代码命令入口](src/code-commands.ts) 和 [源码归属 Use Case](docs/feature/local-sdlc/use-case/trace-code-ownership.md) 定义。避免使用“覆盖率”“完成状态”“测试证据”指代这一关系。

**测试声明（Test Declaration）**：具有明确身份、目标契约和可选回归问题关联的真实测试定义。代码归属声明与测试声明各自表达自己的事实。
