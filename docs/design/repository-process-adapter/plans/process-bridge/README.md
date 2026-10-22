# 进程桥接

Concord 提供双向的窄 JSON 边界：向消费者请求真实原生观察；消费者向公开 engine 命令请求治理算法。
两种请求各启动一个受管进程，不跨进程传递 Effect、Map 或可执行模块。

## Scope

普通原生计划与解析继续使用 `concord.test-adapter/v1`。可靠性消费使用独立的 repository adapter 协议，保持既有政策和持久证据格式。
首个接入替换同进程 host transport；不将整个产品 runner 搬进 Concord。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-单一证据权威) | satisfied | 治理算法只在 engine 中执行 | [架构](architecture.md) |
| [L2](../../LIMITS.md#l2-历史证据保留) | satisfied | 不重签历史；新实现重新取证 | [生命周期](lifecycle.md) |
| [L3](../../LIMITS.md#l3-进程拥有清理) | satisfied | 外层唯一进程组、嵌套继承与失败终结门禁 | [生命周期](lifecycle.md#嵌套进程的唯一回收-owner)；运行验证见 C2 |
| [L4](../../LIMITS.md#l4-原生协议边界) | satisfied | 两类协议不混用证据 | [架构](architecture.md) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-消费者独立运行) | pending | stdio 与公开 engine 命令 | C1/C4 |
| [G2](../../GOALS.md#g2-保持可靠性下限) | pending | 复用权威 validator | C1/C3 |
| [G3](../../GOALS.md#g3-失败可定位) | pending | 严格响应与具名错误 | C2 |

- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
