# 显式 native selector

## Problem

作者在源码标记旁写原生 ID，Concord 在显式执行时使用独立选择元数据；不提供真实收集与自动范围绑定。

## Scope

候选机制及边界见 [Architecture](architecture.md)。表内状态评价设计机制；待验证项不声明运行兼容性。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-正向关系由测试源码拥有) | satisfied | 只用源码关联；native 不进入关系 ID | 架构声明，非运行验证 |
| [L2](../../LIMITS.md#l2-静态操作不执行项目代码) | satisfied | 静态操作不启动外部程序；check 不读观察 | 架构声明，非运行验证 |
| [L3](../../LIMITS.md#l3-不把第三方代码加载进-concord-进程) | satisfied | codec 是外部受信程序，内置维护保持 TS/Effect | 架构声明，非运行验证 |
| [L4](../../LIMITS.md#l4-子进程资源归-concord-管理) | pending | 全 run 协调及报告预算已定义，需真实终结验证 | 架构声明，非运行验证 |
| [L5](../../LIMITS.md#l5-证据只表达实际证明的范围) | pending | 统一裁决已定义；codec 映射尚需验收 | 架构声明，非运行验证 |
| [L6](../../LIMITS.md#l6-既有配置含义不变) | satisfied | 可选配置保持旧 runner；C-011 第 1、3 款已修订 | [宪法 C-011](../../../../constitution.md#c-011) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-标记自动绑定到原生用例) | not-satisfied | 手写 ID，不自动收集或绑定 | 架构声明，非运行验证 |
| [G2](../../GOALS.md#g2-只执行选中的原生用例) | partial | 依赖 provider 的精确选择能力；模式与参数组不通用 | 架构声明，非运行验证 |
| [G3](../../GOALS.md#g3-收据能识别逐用例结果) | partial | TAP/XML 仅 codec，需无碰撞身份映射 | 架构声明，非运行验证 |
| [G4](../../GOALS.md#g4-原生标签可展示且不拥有关系) | not-satisfied | 不读取框架标签 | 架构声明，非运行验证 |
| [G5](../../GOALS.md#g5-新框架不修改-concord-即可接入) | partial | select-plan/report-parse 可扩展；不提供新框架收集 | 架构声明，非运行验证 |

## Entry Points

- [Architecture](architecture.md)
