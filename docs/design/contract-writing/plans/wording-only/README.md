# 只补写作指南，不改宪法

## Problem

同一组写法与关联规则也可以只写进随包写作指南与模板，宪法保持原样。

## Core Mental Model

在随包 skill 的 `document`、`code`、`test` 主题与模板中写明行为页、architecture 页和关联范围的规则，配合样板页。审阅以指南为依据。C-011 与 C-012 不变。

## Scope

- 修改 `skills/concord/references/document.md`、`code.md`、`test.md`、模板与 `docs/concord.md`。
- 宪法不变。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-不改变关联语法与身份算法) | satisfied | 不触及语法、算法与格式 | 只改指南 |
| [L2](../../LIMITS.md#l2-事实仍只有一个-owner) | satisfied | 不改变关联来源 | 只改指南 |
| [L3](../../LIMITS.md#l3-修订遵守宪法修订程序) | satisfied | 不修订宪法 | 宪法不变 |
| [L4](../../LIMITS.md#l4-不把规则写成合规证明) | satisfied | 指南只写规则 | 只改指南 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-不看代码也能判断行为) | satisfied | 指南与样板给出相同写法，读者同样能写出 C1 的断言 | 样板页与 behavior-anchored 共用 |
| [G2](../../GOALS.md#g2-重构不改行为页和测试标记) | partial | 指南要求实现写在 architecture 页，但宪法定义接入项目必须采用的范式（C-010.1）。现行 C-012 不区分行为页与实现页，审阅时没有范式层面的条款可引用 | 现行 C-012.1 只区分声明与过程 |
| [G3](../../GOALS.md#g3-关联能回答哪段代码实现了哪一步) | partial | 与 behavior-anchored 共享缺口：现有步骤与列表提示辅助审阅，没有语义判定；关联范围规则只在指南中 | 两案使用同一套步骤查询，见 behavior-anchored 的 G3 依据 |
| [G4](../../GOALS.md#g4-规则对人和-agent-同样可执行) | satisfied | Agent 读 skill 即可照做 | 指南进入随包 skill |

## Entry Points

本候选只有 README。
