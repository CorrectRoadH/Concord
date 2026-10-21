# 内置门禁与显式外部建议

## Problem

项目可能需要内置词法规则之外的写作建议，但建议工具的依赖、规则和可用性不能决定 Concord 门禁。

## Core Mental Model

本候选完整采用[政策规则架构](../policy-rules/architecture.md)的 v3、计数、合成与迁移。强制规则只由 Concord 政策拥有；外部工具只由用户显式调用，生成独立建议报告。

`check`、文档读取、写入、编辑器静态检查均不启动建议进程，也不使用建议结果。外部工具配置不进入强制政策，不形成第二个强制规则 owner。

## Scope

建议工具的具体产品、版本及中文能力未确认，不能概括所有 linter 的能力。候选仅定义可选进程边界，不声称外部工具满足语法或 STE 合规要求。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-规则由目录作用域的写作政策拥有) | satisfied | 严格 v3 Schema，叶子继承与词表替换 | 机制见 architecture.md，验收见 ../../CASES.md；不是交付证明 |
| [L2](../../LIMITS.md#l2-不分发规范原文且不宣称合规) | satisfied | 自有规则与项目词表，不宣称认证 | 机制见 architecture.md，验收见 ../../CASES.md；不是交付证明 |
| [L3](../../LIMITS.md#l3-门禁确定且不依赖外部进程) | satisfied | 内置检查只读同一当前来源快照 | 机制见 architecture.md，验收见 ../../CASES.md；不是交付证明 |
| [L4](../../LIMITS.md#l4-只接受当前格式并显式迁移) | satisfied | 普通入口只接受 v3；显式 v2 迁移与旧事务恢复边界 | 机制见 architecture.md，验收见 ../../CASES.md；不是交付证明 |
| [L5](../../LIMITS.md#l5-检查成本受规模和输出预算约束) | pending | 词表、输出及 warm p50 预算确定；缺少必需测量证据 | 机制见 architecture.md，验收见 ../../CASES.md；不是交付证明 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-程序性与描述性文本使用不同阈值) | satisfied | 最近 AST 列表类型与独立段落句数 | 机制见 architecture.md，验收见 ../../CASES.md；不是交付证明 |
| [G2](../../GOALS.md#g2-中文与英文分别计数) | satisfied | legacy 与 controlled 两条路径；代码权重、数字、混排与语言选择确定 | 机制见 architecture.md，验收见 ../../CASES.md；不是交付证明 |
| [G3](../../GOALS.md#g3-程序性句子只写一条指令) | partial | 动作词出现次数不证明指令数量，默认关闭 | 机制见 architecture.md，验收见 ../../CASES.md；不是交付证明 |
| [G4](../../GOALS.md#g4-程序性动词来自项目词表) | partial | 词面命中与英文批准词独立开关，不推断词性 | 机制见 architecture.md，验收见 ../../CASES.md；不是交付证明 |
| [G5](../../GOALS.md#g5-报告被动语态) | partial | 仅报告受控模式的命中，允许局部字面豁免 | 机制见 architecture.md，验收见 ../../CASES.md；不是交付证明 |

外部建议不提高以上目标的满足度；候选的增益是独立建议来源，代价是额外生命周期和安装维护。

## Entry Points

- [Architecture](architecture.md)
- [共同内置规则](../policy-rules/architecture.md)
