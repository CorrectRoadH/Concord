# 只补写作指南，不改宪法

## Problem

同一组问题也可以只靠写作指南与模板解决，宪法保持原样。

## Core Mental Model

在随包 skill 的 `document` 主题与模板中写明行为页、architecture 页和关联粒度的规则。C-011 与 C-012 不变。

## Scope

- 修改 `skills/concord/references/document.md`、`code.md`、`test.md` 与模板。
- 宪法与 `docs/concord.md` 不变。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-不改变关联语法与身份) | satisfied | 不触及语法与身份 | 只改文档 |
| [L2](../../LIMITS.md#l2-事实仍只有一个-owner) | satisfied | 不改变关联来源 | 只改文档 |
| [L3](../../LIMITS.md#l3-修订遵守宪法修订程序) | satisfied | 不修订宪法 | 宪法不变 |
| [L4](../../LIMITS.md#l4-不把规则写成合规证明) | satisfied | 指南只写规则 | 只改文档 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-不看代码也能判断行为) | partial | 指南给出写法，但不是接入项目必须遵守的规则，审阅无法据此阻止交付 | 宪法总则：只有宪法条款构成跨功能硬约束 |
| [G2](../../GOALS.md#g2-重构不改行为页和测试标记) | partial | 同上，行为页混入实现时没有可引用的条款 | 同上 |
| [G3](../../GOALS.md#g3-关联能回答哪段代码实现了哪一步) | not-satisfied | 关联粒度只是建议；C-011 仍只覆盖测试，代码声明没有宪法依据 | 现行 C-011 只提到测试标记 |
| [G4](../../GOALS.md#g4-规则对人和-agent-同样可执行) | partial | Agent 能读到指南，但指南与宪法 C-012 的范围不一致 | 现行 C-012 混合五件事 |

## Entry Points

本候选只有 README。
