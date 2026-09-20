# 中立高级治理与消费者执行

保留 `concord repo` 作为中立高级治理入口，采用声明式 suite、按需 native 能力及版本化可靠性要求。产品工具由消费者 CLI 组合，Concord 的模型不依赖产品包名、Nx 或产品协议。

共同 fixed 门槛、原生证据 validator 与生命周期不变量由 Concord 权威实现；不把证据判定随产品工具搬回消费者。详细边界与迁移见 [架构](architecture.md)。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-不强迫技术栈或纯文档目标) | satisfied | 使用中立协议和声明式 suite，产品执行由消费者 CLI 组合，不要求 Concord 开发栈。 | 原候选正文明确不依赖产品包名、Nx 或产品协议。 |
| [L2](../../LIMITS.md#l2-保留编辑并禁止外部副作用) | pending | 架构明确保留 Web 编辑，并限定真实验收无付费、无远端副作用；本次迁移不复验这些运行时/现场结果。 | [有限真实验收](architecture.md#有限真实验收)记录设计要求；这是设计论证，不是执行证明。 |
| [L3](../../LIMITS.md#l3-证据类型与旧原件不可降级) | satisfied | 原生证据 validator 与 fixed 门槛由 Concord 权威实现，不把证据判定搬回消费者。 | 原候选正文明确证据判定边界。 |
| [L4](../../LIMITS.md#l4-身份绑定与-redgreen-候选规则) | satisfied | 架构绑定 helper、policy、配置和 adapter 身份；red 可使用缺陷候选，green/reliability 必须使用同一修复候选。 | [证据要求](architecture.md#证据要求)明确这些规则；这是设计论证，不是执行证明。 |
| [L5](../../LIMITS.md#l5-fixed-门槛与迁移保护统一) | satisfied | 所有 fixed 入口共享最低要求；迁移在停写窗口持有旧、新 exclusive flock，校验 journal 和完整前像并保留可恢复现场。 | [离线切换](architecture.md#离线切换)明确共同门槛、锁、journal 和前像机制；这是设计论证，不是执行证明。 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-建立中立治理规则) | satisfied | 保留中立高级治理入口，模型不依赖产品包名、Nx 或产品协议。 | 原候选正文明确中立协议边界。 |
| [G2](../../GOALS.md#g2-保留治理证据与生命周期) | satisfied | Concord 权威实现共同 fixed 门槛、原生 evidence validator 与生命周期不变量。 | 原候选正文明确这些治理职责保留。 |
| [G3](../../GOALS.md#g3-移出产品专属工具并证明中立性) | pending | 产品工具归消费者 CLI 组合，但真实非 Nx 与 NiceEval 接入仍需验收。 | DECISION 明确真实消费者验收为后续工作。 |
