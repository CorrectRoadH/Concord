# 模块 host

消费者安装与全局 CLI 同字节的 Concord 包，并 default-export `concord.repository-host/v2`。
Concord 按需加载同进程 Effect 能力。普通 test-adapter 保持独立原生观察用途。

## Scope

维持现有引擎身份、六项原生能力和可靠性政策；通过修正安装配方及错误信息改善使用。
该方案不达成消费者去掉 Concord 内部库的目标。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-单一证据权威) | satisfied | Concord library 共享算法 | [架构](architecture.md) |
| [L2](../../LIMITS.md#l2-历史证据保留) | satisfied | 保留当前格式和历史 | [生命周期](lifecycle.md) |
| [L3](../../LIMITS.md#l3-进程拥有清理) | pending | 消费者 Effect Scope | C1/C3 |
| [L4](../../LIMITS.md#l4-原生协议边界) | satisfied | formal 与普通 native 分开 | [架构](architecture.md) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-消费者独立运行) | not-satisfied | 必须安装并 import Concord 库 | [架构](architecture.md) |
| [G2](../../GOALS.md#g2-保持可靠性下限) | pending | 现有权威 validator | C1/C3 |
| [G3](../../GOALS.md#g3-失败可定位) | pending | 原因保真诊断 | C2 的模块等价场景 |

- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
