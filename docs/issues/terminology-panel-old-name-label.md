---
relations:
  - role: spec
    target: docs/feature/documentation-quality/format.md
---

# 工作台术语面板写“弃用名称”而不是“旧写法”

## 现象

`web/components/terminology-panel.tsx:50` 把概念的旧写法显示为“弃用名称：…”，`test/e2e/view-browser.e2e.ts:124` 断言这段文字。全局术语表用“旧写法”称呼这些写法（[旧写法](../concepts.md#deprecated-name)）。

## 期望

工作台显示“旧写法：…”，与概念格式及术语表一致；测试断言随之改为新文字。
