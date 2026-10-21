---
format: concord.document/v1
id: run-native-test-adapters
title: 通过 adapter 执行原生测试用例
createdAt: 2026-10-21T09:27:53.033Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 通过 adapter 执行原生测试用例

## 场景

作为使用 Node test、Vitest、pytest、Go 或 Cargo 的项目维护者，我希望 `concord test run` 只执行标记对应的原生用例，并在收据中看到每个选中用例的真实结果。

## 主流程

1. 在 `concord.config.ts` 的 `testAdapters` 中为测试目录声明内置或外部 adapter。未覆盖的文件继续使用 `runner`。
2. `concord test collect` 显式运行框架收集，产生原生清单观察；`check`、`trace` 与 `test list` 不运行收集。
3. `concord test run <case-id>` 在执行前重新收集目标文件，把标记绑定到原生用例，或使用标记中的 `@native` 后备选择，只执行选中集合。
4. 收据记录 requested 与 observed，按共同契约给出 green、red 或 invalid。

## 验收

- 测试关联只由源码标记拥有；原生清单、标签与选择不改变 case 集合、case ID 或 `check` 结论。
- 协议、绑定、能力矩阵、输入身份与 run 协调见[采用设计](../../../design/test-adapters/plans/process-adapter/architecture.md)。收据裁决见[共同身份](../../../design/test-journey-steps/共同身份.md#原生执行收据)。
- 能力矩阵中未经固定版本验收的组合不宣称支持。
- 验收场景见 [CASES](../../../design/test-adapters/CASES.md)。
