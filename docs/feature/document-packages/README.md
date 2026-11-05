# 文档目录与完整发现

维护者在 Concord 中看到消费仓库的全部文档：Feature、Engineering、Roadmap、Design 与 Issue。文档的身份由路径决定，名称取自正文唯一的一级标题（[领域与数据所有权](../local-sdlc/format.md#owner)）；无法读取的文档产生诊断，并把结果标为不完整，原文件保持不动。

## 你可以做什么

- 用中文等 Unicode 名称命名目录、Use Case 文件和自定义页面，不需要另建英文副本。
- 在 CLI 与 Web 中看到同一份文档清单：CLI 和 Web 使用同一套发现规则。
- 编辑文档的同时运行检查：检查期间文件被改动时，Concord 自动重试，不把半途的状态报告为结论。

## 用户路径

- [发现受管文档](use-case/discover-managed-documents.md)

## 细节

- [实现](architecture.md)

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
