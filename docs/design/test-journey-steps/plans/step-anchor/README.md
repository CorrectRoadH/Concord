# 列表项 anchor

## Problem

显式列表步骤可直接阅读；共同身份决定领域范围、命名空间与引用兼容。

## Scope

候选机制及边界见 [Architecture](architecture.md)。表内状态评价设计机制；待验证项不声明运行兼容性。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-正向关系只由源码标记拥有) | satisfied | 源码是唯一正向来源 | 架构声明，非运行验证 |
| [L2](../../LIMITS.md#l2-派生结果不表达证据) | satisfied | 关联和观察不作执行证据 | 架构声明，非运行验证 |
| [L3](../../LIMITS.md#l3-契约正文只写声明) | satisfied | 步骤 ID 排除写作计数 | 架构声明，非运行验证 |
| [L4](../../LIMITS.md#l4-只接受当前格式) | satisfied | 保持 v1，摘要使目标变更后的旧证据失效 | 架构声明，非运行验证 |
| [L5](../../LIMITS.md#l5-相关性判定不执行项目代码) | satisfied | 静态关系不依赖观察 | 架构声明，非运行验证 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-测试可以指向单个步骤) | satisfied | 显式步骤可引用 | 架构声明，非运行验证 |
| [G2](../../GOALS.md#g2-没有测试的步骤可以被发现) | satisfied | 派生未关联视图 | 架构声明，非运行验证 |
| [G3](../../GOALS.md#g3-观察测试依赖与声明的交集) | partial | 只观察正向交集；黑盒边界保留 gaps | 架构声明，非运行验证 |
| [G4](../../GOALS.md#g4-契约正文保持可读) | satisfied | 连续列表 | 架构声明，非运行验证 |
| [G5](../../GOALS.md#g5-步骤身份在普通编辑下稳定) | satisfied | 显式 ID 独立于文字与顺序 | 架构声明，非运行验证 |
| [G6](../../GOALS.md#g6-步骤-id-的书写与维护成本低) | satisfied | Unicode ID、`use-case format` 补齐、`rename-step` 原子改写引用 | 架构声明，非运行验证 |

## Entry Points

- [Architecture](architecture.md)
