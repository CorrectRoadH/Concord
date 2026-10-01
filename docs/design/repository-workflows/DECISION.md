# 候选比较

## Decision

Selected: [main-cli-owned](plans/main-cli-owned/README.md)

## Rationale

本地 Issue 的 CRUD 已被 Web、action 与无 profile 的消费者使用，[本地观察契约](../../feature/feedback/use-case/manage-local-observations.md)要求不依赖外部服务与高级治理配置。把 Issue 写入口收进 `concord repo` 会让基础流程依赖 `concord.repository.json`，违反 L4 与 C-002。把七种闭合类型、adopt/retire 和 reopen 补进基础 `concord issue`，再退役 Feedback 一侧的写命令，可以只保留一个写入口，且不改变持久格式。

远端写入复用已有 plan store、CAS 与 gh 受管进程，只在 execute 路径开放固定的写请求。Docs Work 放在基础 `docs` 组，纯文档仓库也能使用。命令贡献让 `concord repo` 与消费者宿主组合同一份定义。

## Rejected Options

profile-owned 在 L4 上不满足：无 profile 的项目失去本地 Issue 写入，Docs Work 也被绑定到 suite 配置。

## Residual Risks

- 退役 `feedback create/link/close` 与 `repo feedback link/adopt/retire/close/reopen` 会破坏既有调用。缓解方式是 `CommandRetired` 加迁移表，没有双写过渡期；Feedback CLI 页面、本地观察 Use Case 与随包指引须在同一版本修订。
- 授权串证明调用方声明了授权，不证明授权真实存在；Agent 不推断授权的约束由随包指引与 C-007 承担。
- manual create 与 comment-add 没有幂等键，结果不确定时只能人工核对。
- Docs Work 不报告任何 item 都未声明的路径上的改动，归因由父 Agent 的 diff 验收承担。
- 以上为设计推理，执行证据在实现与打包验收后补齐。
