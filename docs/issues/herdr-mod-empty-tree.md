---
relations:
  - role: spec
    target: docs/feature/herdr-mod/ui.md
---

# Concord mod 的文档列表是空的

## 现象

herdr-app 中打开已经初始化的仓库，Concord mod 读完文档后左栏一行也不显示，连分组标题都没有；`concord list feature` 在同一仓库能列出全部 Feature。本机与远程机器都一样。

文档列表用 `v_virtual_list` 画行，每一行在列表的渲染回调里注册 `on_click`。herdr-app 的 `v_virtual_list` 不允许在渲染回调里注册处理函数，调用即抛错，于是整份列表画不出来。

## 期望

文档列表按[文档列表](../feature/herdr-mod/ui.md#文档列表)显示分组与文档包；点箭头只展开或折叠，点标题打开它的 `README.md` 并展开。
