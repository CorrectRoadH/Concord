# 统一项目治理与中立测试接入

维护者想用同一套规则管理任何软件项目的 Spec、实现关联、测试关联、Issue 与 Memory，不必先照搬某个产品的仓库工具。已有项目适配这些规则；不能以兼容某个消费者为由，让它的产品路径、运行通道或工具协议成为所有项目的前提。

NiceEval 是实践来源与接入消费者。公开入口验收、候选与 Spec 一致性、先失败后修复的回归核验、隔离和清理等实践提升为中立规范；产品 Preview、示例素材同步、具体包名、Nx 配置与部署接口由消费者拥有。

## 你可以做什么

- 在自己的软件项目里走完 Spec → 测试关联 → 运行 → 修复核验的闭环，测试框架和运行方式仍由项目决定。
- 把一批文档工作切成互不重叠的写集，交给多个 Agent 并行完成，再逐份重跑检查验收。
- 在取得明确授权后，对 GitHub Issue 执行一次可核验的写入。

## 上手

在一个实现在 `src/`、测试在 `spec/` 的软件项目里接入，并让 runner 用 `node --test` 运行测试：

```sh
concord init --test-root spec --runner-config runner.json
```

```text
Start here: docs/concord.md
Writing guide: concord --skill docs-from-code
Inspect configuration: concord doctor
```

给测试加上标记后，通过项目的 runner 运行它：

```sh
concord test run neref_7c0a61a1e94b429fafcb4e49eb734a90
```

```text
Command pass — neref_7c0a61a1e94b429fafcb4e49eb734a90
Scope: command (does not prove native case coverage)
Execution: unknown; exit: 0; cleanup: true
Timeout: false; cancelled: false; signal: null
Arguments: ["node","--test","spec/add.test.mjs"]
```

完整步骤见[按 Concord 规范接入软件项目](use-case/adopt-neutral-governance.md)。

## 怎样工作

每个接入项目都遵守以下规则：

- Spec、实现声明、测试定义、Issue 和 Memory 各有唯一 owner，反向关系派生；Spec 采用统一布局，身份由路径推导。
- Feature 与 Use Case 明确目标和可观察验收，重要取舍通过 Design 记录；实现声明与测试声明显式关联 Spec。
- 测试声明与执行结果必须区分；源码标记不显示为执行通过，`test run` 的结果不声称逐 case 覆盖或正式可靠性。
- Issue 以 fixed 关闭前必须通过[修复核验](../local-sdlc/README.md#证据的范围)。执行适配、入口或界面变化不得把核验降级为普通命令成功。
- Concord 的写入具备范围校验、前像冲突保护和中断恢复；直接编辑的结果由 `check` 检查。

项目拥有测试框架、执行环境、运行通道、构建产物和部署方式。Concord 不把 host/provider、固定通道、特定产品包名或 Nx 布局当作通用治理字段。产品工具归消费者、治理规则归 Concord；所有权划分见[治理边界](architecture.md)，测试执行边界见[项目测试接入边界](../local-sdlc/README.md#测试的边界)。

## 用户路径

- [按 Concord 规范接入软件项目](use-case/adopt-neutral-governance.md)
- [并行切分文档工作](use-case/coordinate-docs-work.md)
- [计划并执行一次远端 Issue 写入](use-case/mutate-remote-issue.md)

## 范围与验收方式

本功能面向软件项目，不以纯文档项目作为方案成立或能力拆分的理由，不要求消费者采用 Concord 自身的开发栈。Spec 声明不等于验收通过：每个 Use Case 用打包后的公开 CLI 在隔离 Git 消费仓库中验收。

## 细节

- [命令](cli.md)：`docs work` 与 `issue remote` 的调用、配置、输出与错误码。
- [治理边界](architecture.md)：所有权、离线切换、写入计划存储与 Docs Work 状态文件。

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
- [总则](../../taste.md#general-amend)
- [写现在，不写过去](../../taste.md#t-4)
