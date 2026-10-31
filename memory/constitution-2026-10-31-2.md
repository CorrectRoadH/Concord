---
type: decision
status: current
relations:
  - role: amends
    target: docs/constitution.md#c-016-1
  - role: amends
    target: docs/constitution.md#c-016-2
---

# C-016：Feature 页面分产品功能、技术架构与 Use Case，不同情形各写一个 Use Case

宪法修订，日期 2026-10-31。

## 适用范围

Concord 自身的 Feature 页面：README、cli 与 library 页、architecture 页和 Use Case。

## 理由

维护者明确了 Feature 文档的三类页面：产品功能写成使用教程，技术架构单独成页，Use Case 把功能连到用户旅程。功能在不同情形下的不同输出，应作为一个个 Use Case 展示，而不是用子规则列表枚举。原 C-016-2 把异常分支放进 Use Case 的结果节，仍是在一个页面里枚举规则。

## 影响

- C-016-1：README 与 cli、library 页定为产品功能（使用教程），architecture 页定为技术架构，Use Case 定为用户旅程；不再把失败语义与读取边界列为 README 之外的支持页内容。
- C-016-2：一个 Use Case 对应一个情形；输入、状态或失败不同而表现不同时另写 Use Case。
- 已有的规则枚举页，例如 local-sdlc 的 `scope.md` 与 documentation-quality 的 `gate.md`，按情形改写成 Use Case 的工作记录在 Issue `spec-readability-gaps`。

## 来源

- `docs/feature/local-sdlc/scope.md`
- `docs/feature/documentation-quality/gate.md`
