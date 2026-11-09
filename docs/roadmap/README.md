# Roadmap

Roadmap 保存尚未采用的产品方向，页面种类与 Feature 相同（[页面种类](../document-model.md#页面种类)）。方向进入 Roadmap 而不是 Feature，是因为设计还不完整或暂不安排实现；实现与测试不指向它。

使用 `concord list roadmap` 查看全部 Roadmap，`concord new roadmap <名称>` 创建。采用时运行 `concord roadmap start <名称>` 移入 `docs/feature/` 并改写引用；取消方向直接删除目录，历史由 Git 保存。
