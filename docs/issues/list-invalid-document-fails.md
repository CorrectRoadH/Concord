---
relations:
  - role: adopts
    target: docs/feature/document-packages/use-case/discover-managed-documents.md
---

# 一篇文档格式无效时 list 整体失败

## 现象

仓库中有一篇没有一级标题的 Issue 时，`concord list issue` 整体失败（`InvalidData`，退出 1），其它文档也不列出；同一仓库的 `concord check` 给出带路径的 finding 与 `complete: false`。由 docs-refactor-data 在临时仓库实测（`/tmp/concord-closure/docs-refactor-data-delivery.md` 待决 2）。

## 期望

发现照常列出其余文档，无效文档给出带路径的诊断，结果标为不完整，不改动原文件（[完整发现受管文档](../feature/document-packages/use-case/discover-managed-documents.md#invalid)）。CLI 与 Web 使用同一清单与同一规则。
