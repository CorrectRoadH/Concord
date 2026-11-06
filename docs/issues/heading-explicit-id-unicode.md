---
relations:
  - role: adopts
    target: docs/feature/local-sdlc/format.md
---

# 标题末尾的中文显式 ID 不生成 anchor

## 现象

`src/model/markdown-facts.ts:14` 的 `markdownAnchor` 只接受 ASCII 开头的显式 ID，而且标题中一旦出现 `{#` 就不再生成 slug：`## 完整路径 {#主流程}` 让 `#主流程` 与 `#完整路径` 都失效，引用它们的标记报 `AnchorNotFound`。`headingAnchorsFromTree` 接受任意显式 ID，步骤 ID 允许中文，三处规则不一致。由 docs-refactor-sdlc 与 docs-refactor-workbench 发现。

## 期望

显式 ID 的语法与文档名相同，按原始 Unicode 拼写精确匹配，与同文件标题 anchor 共用命名空间（[步骤](../feature/local-sdlc/format.md)）。标题、步骤与引用检查使用同一个解析规则。修复后，代码中指向 `#主流程`、`#约束`、`#验收`、`#配置与结果` 等标题的标记可以改指 Use Case 的步骤 ID，相应标题再统一为 `完整路径`、`结果`。
