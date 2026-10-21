# 静态关联与进程 adapter

## Problem

源码静态重建关系；真实收集和范围仅增强执行。自动绑定不足时使用显式 selector，仍保持独立关联身份。

## Scope

候选机制及边界见 [Architecture](architecture.md)。表内状态评价设计机制；待验证项不声明运行兼容性。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-正向关系由测试源码拥有) | satisfied | 静态标记唯一拥有关系，观察不影响 ID | 架构声明，非运行验证 |
| [L2](../../LIMITS.md#l2-静态操作不执行项目代码) | satisfied | check 不读取清单；仅显式命令收集 | 架构声明，非运行验证 |
| [L3](../../LIMITS.md#l3-不把第三方代码加载进-concord-进程) | satisfied | 内置 TS/Effect，外部受信子进程 | 架构声明，非运行验证 |
| [L4](../../LIMITS.md#l4-子进程资源归-concord-管理) | pending | run 全周期与预算已定义，需真实生命周期验收 | 架构声明，非运行验证 |
| [L5](../../LIMITS.md#l5-证据只表达实际证明的范围) | pending | 统一集合裁决已定义，需各 codec 原生验证 | 架构声明，非运行验证 |
| [L6](../../LIMITS.md#l6-既有配置含义不变) | pending | 可选配置及旧证据边界已定义；C-011 修订是采用前提 | 架构声明，非运行验证 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-标记自动绑定到原生用例) | partial | 范围与真实收集支持依框架版本，矩阵保留未确认 | 架构声明，非运行验证 |
| [G2](../../GOALS.md#g2-只执行选中的原生用例) | partial | 重复名称与动态子项需要明确能力，不能通用承诺 | 架构声明，非运行验证 |
| [G3](../../GOALS.md#g3-收据能识别逐用例结果) | partial | 逐项报告需固定 provider 和 codec 映射验收 | 架构声明，非运行验证 |
| [G4](../../GOALS.md#g4-原生标签可展示且不拥有关系) | partial | 只展示 provider 返回元数据；可用性依版本 | 架构声明，非运行验证 |
| [G5](../../GOALS.md#g5-新框架不修改-concord-即可接入) | satisfied | 有版本 envelope 和 plan/parse 扩展边界 | 架构声明，非运行验证 |

## Entry Points

- [Architecture](architecture.md)
