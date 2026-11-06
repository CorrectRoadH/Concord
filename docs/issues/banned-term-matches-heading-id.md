---
relations:
  - role: spec
    target: docs/feature/documentation-quality/format.md
---

# 写作检查把标题的显式 ID 当作正文匹配

## 现象

概念登记旧写法后，写作检查也在标题末尾的显式 ID 中匹配它：给“远端写入计划”登记旧写法 `receipt`，`## 收据 {#receipt}` 与 `## 远端写入计划 {#issue-receipt}` 都报 `bannedTerm`；登记 `preimage` 时 `## 前像 {#preimage}` 同样报告（`/tmp/concord-closure/docs-terms-global-delivery.md` 待决 1）。这些 ID 被其它页面引用，必须保留，因此 `receipt` 与 `preimage` 目前无法登记为旧写法。

## 期望

显式 ID 不是正文，写作检查跳过它，与跳过行内代码相同（[概念与写作规则的格式](../feature/documentation-quality/format.md)）。修复后在 neutral-project-governance 的术语表为“远端写入计划”登记旧写法 `receipt`，在全局术语表为“前像”登记 `preimage`。
