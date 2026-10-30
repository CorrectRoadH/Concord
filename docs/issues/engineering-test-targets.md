---
status: open
---

# 测试标记不能指向 Engineering

## 现象

测试标记只能指向 Feature、Use Case 或其步骤，代码声明却可以指向 Engineering（[追踪代码归属](../feature/local-sdlc/use-case/trace-code-ownership.md)）。守护仓库维护机制的测试，例如 `test/architecture.test.ts` 检查的[依赖规则](../architecture.md#依赖规则)，没有合法目标，只能不带标记，trace 看不到它们。

## 待决

是否允许测试标记指向 Engineering 与 `docs/architecture.md`：这会增加 `contractKind` 的取值，并让 trace、步骤视图与修复核验接受这些目标。
