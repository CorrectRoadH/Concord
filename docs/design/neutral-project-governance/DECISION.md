# 裁决依据

## Decision

Selected: [generalize-profile](plans/generalize-profile/README.md)

## Rationale

采用 generalize-profile：产品工具归消费者，身份、证据和生命周期治理由 Concord 拥有。

消费者拥有产品命令与 runner；Concord 拥有身份、证据和生命周期的统一规则与权威校验。

G1: generalize-profile 保留中立高级治理入口，产品工具由消费者 CLI 组合；中立性仍需真实非 Nx 消费者和 NiceEval 接入验收，当前记录不冒充完成。

G2: 方案保留统一最低证据要求、原生证据 validator 与生命周期不变量；原文支持治理保留，但实际实现验收仍待完成。

G3: 方案把产品工具归还消费者，并明确 Concord 模型不依赖产品包名、Nx 或产品协议；真实接入证明仍是剩余风险。

不重写全部 native 执行编排；重点收敛权威校验。必须落实：red 候选可与 green 不同、所有 fixed 入口同一门槛、实际副本语义与完整 cleanup、跨旧新锁的停写切换、中立打包消费者与 NiceEval 真实 runner 验收。重大契约变化须重新挑战。

设计裁决不证明实现与验收结果。

## Rejected Options

consolidate 将 repository 的注释、trace、文档写入和正式证据全部合并到 src 单一实现，移除 repo 入口。优点是减少内部重复；代价是同时重建正式执行接入、历史与恢复边界。中立实践要求先收敛关键不变量并保留成熟执行机制，内部目录统一不属于该目标。

## Residual Risks

实际副本语义、完整 cleanup、跨旧新锁停写切换、中立打包消费者和 NiceEval 真实 runner 尚需实现与验收。独立挑战和静态审计是设计证据，不能替代消费者测试或 native/reliability 证明。
