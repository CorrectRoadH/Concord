# Concord 自举维护

本主题规定 Concord 怎样用当前检出的源码 CLI（`pnpm concord`）维护本仓库的 Spec。仓库中的 Markdown 与真实测试标记共同接受 `doctor`、`check`、`trace` 和 `review` 验证；最终质量门是 [`pnpm gate`](../testing/README.md#检查入口)。

构建与源码运行见[构建与开发环境](../build/README.md)，测试规则见[测试](../testing/README.md)，性能测量见[性能测量](../performance/README.md)。

## 用 Concord 管理自身

Concord 用自己的流程开发和验收自己。

1. 新功能先声明目标 Feature 与完整 Use Case，重要方案经 Design 比较和裁决。
2. 验收测试在声明旁关联 Spec。交付必须通过 `pnpm gate`，测试运行源码并验证公开 CLI。
3. Concord 的 check、trace 与 review 用于检查自身关系，不虚构测试关联或完成状态。

## 目标

- 自举配置使用公开 runner argv，不依赖 shell 或 NiceEval。
- sourceRoots 覆盖 `src`、`repository`、`web` 与 `scripts`；testRoots 覆盖 `test`。
- sourceFiles 纳入测试支持、TypeScript 配置、包清单与锁文件。
- 自举检查只读检查当前仓库的配置与可扫描标记，不递归运行完整门禁，也不修改当前仓库。命令见[自举检查命令](cli.md)，隔离副本的机制见[自举实现](architecture.md)。

## 维护流程

1. 修改 Spec 前读取当前页面；用 `pnpm concord show <路径>` 查看它的关系、测试与实现。
2. 直接编辑 `docs/` 与 `memory/` 下的文件，编辑后运行 `pnpm concord check`。
3. 新增或调整真实测试时，在声明正上方维护标记；先为 Feature 或 Use Case 写好 Spec，再在已有真实测试中选择最接近的验收声明添加关系，不为了数字注册空测试。
4. 运行类型检查和目标测试，再运行 Concord 的 doctor、check、trace 与 review。
5. 交付前执行完整 `pnpm gate`。

| 情形 | 做法 |
| --- | --- |
| 调整 runner | runner argv 或 sourceFiles 变化会使旧的 [command evidence](concepts.md#command-evidence) 不再代表当前定义。先用 doctor 与 check 验证配置，再按需重新采集 |
| 修复中断写入 | 读取遇到 `RecoveryRequired` 时停止其它写入，检查 journal 与文件内容后运行 `recover`；出现未知编辑时保留现场，由维护者裁决 |
| 审阅交接 | reviewer 用 trace 与 review 输出定位 Spec、测试和 Memory，再直接审阅正文与源码。命令收据是可复核输入，不替代测试设计判断 |

## 仓库文档入口

根目录的 README 面向产品使用者，`AGENTS.md` 提供 coding agent 的开发入口。产品行为、架构、界面规范和工程说明放在 `docs/` 的所属页面；领域术语只由 `concepts.md` 定义，不另设根目录上下文或设计说明副本（[一件事只写一次](../../taste.md#t-3)）。

[来源与第三方声明](../../notices.md)随 `docs/` 进入发行包；许可证原文和自动生成的第三方材料留在各自源码或构建产物中。发行与测试生成的压缩包是产物，不作为仓库文档保留。

## 协作与授权

多个任务并行修改同一个仓库，对外操作需要明确授权。

1. 保留其他任务的改动，控制写入范围。
2. 未经明确授权不得 push、发版、操作生产、调用付费模型或发送外部消息。版本、安装指南、发版和生产操作不属于自举的自动动作。
3. 破坏消费者兼容、改变持久数据含义、重划资源所有权或信任边界、回滚依赖协调迁移的方案，必须先完成独立设计挑战：由未参与方案的 reviewer 只读审查并给出书面结论，存在未解决的阻断意见时不得定案。

## 完成条件

当前检出可由源码 CLI 完成 `doctor`、`check`、`test list`、`trace show/check` 与 `review`；类型检查和相关测试通过。
