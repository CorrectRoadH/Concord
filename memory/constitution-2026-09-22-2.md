---
type: decision
status: current
relations:
  - role: amends
    target: docs/constitution.md
---

# 测试关联改为源码标记，不再解析宿主测试语法

宪法修订，日期 2026-09-22。

## 理由

测试关联改为源码标记，不再解析宿主测试语法

## 影响

标记存在即构成测试关联；旧的按测试标题派生的 neref_ 不再视为同一身份，已有命令证据须重新取证。不改变代码声明的 AST 规则，也不把命令收据升级为原生用例通过

## 来源

- `docs/constitution.md#c-010`
- `docs/architecture.md`
