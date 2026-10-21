# 政策规则

## Problem

本候选将受控写作规则纳入内置检查，保持目录政策是唯一规则来源。

## Core Mental Model

`concord.writing/v3` 保留 legacy 字符路径，增加独立 controlled token 路径。合法步骤标记统一剔除；行内代码在 controlled 中计 1，内容不参与词表。

controlled 的对象逐叶合成，null 清除子树，数组按最近显式整表替换，空数组是显式空表。词法开关默认 false，是否要求动作词、是否限制出现次数与是否检查批准词相互独立。

## Scope

提供分类型句长、段落句数、词面匹配与显式豁免。不提供完整语法、词性、词义或指令数量证明。v3 的格式选择、迁移与入口清单见架构；Design 裁决保持 Undecided。

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

## Entry Points

- [Architecture](architecture.md)
- [验收场景](../../CASES.md)
