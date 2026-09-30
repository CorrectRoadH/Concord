# 变更审阅

本地工作台展示当前工作区；PR 预览展示冻结提交。用户路径分别由[本地未提交变更](use-case/review-local-changes.md)与[PR 预览](use-case/review-pull-request.md)拥有。

[PR 变更审阅方案](../../design/pr-change-preview/README.md)比较静态导出与托管服务，定义共同目标、权限边界和验收场景。[静态架构](../../design/pr-change-preview/plans/static/architecture.md)规定比较身份、产物结构、预算和资源生命周期。

消费者负责 Git 获取、PR 身份与托管；Concord 负责差异与阅读页面，不执行部署或 PR 写入。
