# 候选比较

## Decision

Selected: [static](plans/static/README.md)

## Rationale

静态导出将提交比较与托管分开，消费者只接收可审阅的文件集合。它满足公开阅读的目标，并使 Node 服务、工作区扫描与仓库执行能力留在本地边界。

G3: 消费者仍须取得真实 PR 身份、准备 Git 历史并固定工具包。这些职责由消费者的 CI 和发布配置拥有，Concord 不接管远端平台权限。

## Rejected Options

托管完整工作台需要新增认证、只读操作分组、执行隔离和服务生命周期；这些机制超出文件审阅需求。仅隐藏编辑按钮无法满足权限约束。

## Residual Risks

静态方案需要对输出竞争、特殊 Git 对象、内容预算和消费者身份获取分别验收。Markdown 正文与 diff 不是测试执行证据；发布文件检查也不证明远端 PR 链接可用。
