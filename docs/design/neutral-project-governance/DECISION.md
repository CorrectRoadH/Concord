# 裁决依据

## Decision

Selected: [generalize-profile](plans/generalize-profile/README.md)

## Rationale

2026-09-20，Herdr 独立 Astra `concord-neutral-grill-0920` 只读读取两个仓库，在 Q1–Q9 问答后给出 PASS（设计裁决，不代表实现验收）。采用 generalize-profile 的收敛版本。

独立 Sol `concord-neutral-audit-0920` 静态核对了消费者依赖、29 份 runner 类型快照和产品命令组合；其发现支持将产品工具归还消费者，将身份/证据/生命周期治理留在 Concord。

G1: generalize-profile 保留中立高级治理入口，产品工具由消费者 CLI 组合；中立性仍需真实非 Nx 消费者和 NiceEval 接入验收，当前记录不冒充完成。

G2: 方案保留统一最低证据要求、原生证据 validator 与生命周期不变量；原文支持治理保留，但实际实现验收仍待完成。

G3: 方案把产品工具归还消费者，并明确 Concord 模型不依赖产品包名、Nx 或产品协议；真实接入证明仍是剩余风险。

不重写全部 native 执行编排；重点收敛权威校验。必须落实：red 候选可与 green 不同、所有 fixed 入口同一门槛、实际副本语义与完整 cleanup、跨旧新锁的停写切换、中立打包消费者与 NiceEval 真实 runner 验收。重大契约变化须重新挑战。

两个只读 worker 均未修改代码，父 agent 读取交接后已回收其 tab。实现与验收由后续执行负责，不能使用此次 PASS 代替测试结果。

## Rejected Options

consolidate 将 repository 的注释、trace、文档写入和正式证据全部合并到 src 单一实现，移除 repo 入口。优点是最终减少内部重复；代价是同时重建正式执行接入、历史与恢复边界。本轮未选；用户要求中立实践，不要求通过一次全面重写达成内部目录统一，先收敛关键不变量并保留成熟执行机制更便于实际验收。

## Residual Risks

实际副本语义、完整 cleanup、跨旧新锁停写切换、中立打包消费者和 NiceEval 真实 runner 尚需实现与验收。独立挑战和静态审计是设计证据，不能替代消费者测试或 native/reliability 证明。
