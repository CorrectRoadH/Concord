---
relations:
  - role: spec
    target: docs/feature/documentation-quality/format.md
---

# 工作台界面文字没有用术语表的写法

## 现象

`web/components/terminology-panel.tsx:50` 把概念的旧写法显示为 `弃用名称：…`，`test/e2e/view-browser.e2e.ts:124` 断言这段文字。全局术语表用“旧写法”称呼这些写法（[旧写法](../concepts.md#deprecated-name)）。

同类的界面文字还有：`web/pages/operations.tsx` 写 `来自服务端结构投影的诊断`，术语表的写法是[工作区投影](../feature/web-workbench/concepts.md)；写作页（`web/pages/writing.tsx:273-317`）与 [界面](../feature/web-workbench/ui.md) 的范围选择写 `适用范围`，术语表的写法是[生效范围](../feature/documentation-quality/concepts.md)。

## 期望

工作台的界面文字使用术语表的写法：`旧写法：…`、工作区投影、生效范围。先改 [界面](../feature/web-workbench/ui.md) 中的对应文字，再改代码与测试断言。
