---
relations:
  - role: spec
    target: docs/feature/web-workbench/ui.md
---

# 分类默认预览覆盖用户先点的条目

## 现象

浏览器门禁 run-fm0cPJ 中 knowledge 用例的 trace 显示路由为 `/memory` → `second-memory` → `first-memory`：用户已点击第二条，分类入口的默认跳转随后又把预览换回第一条。`web/pages/documents.tsx` 在渲染时无条件以 `<Navigate replace>` 跳到第一项，与侧栏点击竞争。测试补等默认项就绪后再点击，只掩盖了这一竞争。

## 期望

按[界面](../feature/web-workbench/ui.md)：默认预览只在 URL 还没有选择时生效，用户先点的条目不被覆盖。先写在默认跳转前点击的失败回归，再按 `--fixed` 修复。
