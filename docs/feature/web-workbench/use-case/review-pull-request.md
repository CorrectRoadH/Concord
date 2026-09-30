---
format: concord.document/v1
id: review-pull-request
title: 在 PR 预览中审阅变更
createdAt: 2026-09-30T00:00:00.000Z
kind: use-case
feature: docs/feature/web-workbench/README.md
---

# 在 PR 预览中审阅变更

审阅者打开 PR 提供的 Concord 预览，看到该 PR 相对于合并目标分支引入的变更。目标分支由 PR 的 base 决定，不假定名称为 main。

## 主流程

1. 消费者 CI 取得 PR 的目标分支、base commit 与 head commit，并准备包含共同祖先的 Git 历史。
2. 运行 `concord view export --base <base-commit> --head <head-commit> --base-label <target-branch> --out <new-directory>`。
3. 消费者将输出目录接入既有静态 Preview，并从 PR 链接到该页面。
4. 审阅者看到目标分支、base、head 与 merge-base 身份，选择文件并阅读差异。文档同时提供变更前后正文；所有内容来自已冻结提交。

## 验收

- 比较为 `merge-base(base, head)` 到 head；目标分支独有的后续提交不出现在 PR 差异中。
- 支持非 main 目标、detached HEAD、fork 的已取得 head、删除、重命名和无变化；工作树未提交内容不进入输出。
- 缺失 revision、浅历史、多个最佳共同祖先、预算超限和不安全输出路径具名失败，不回退 main 或本地 HEAD。
- 页面可部署在子路径；选择文件可通过链接恢复。二进制、子模块与符号链接不读取外部目标。
- 预览仅有静态阅读能力，无编辑、测试执行、工作区 API 或凭据；Markdown 不执行 HTML、MDX 或图解代码。
- 输出包含所比较的已提交内容，发布范围由消费者审阅；Concord 不获取远端凭据、不 fetch、不部署、不写 PR 评论。
- 页面不把 diff 或测试声明当作执行证据。
