---
type: decision
status: current
relations:
  - role: amends
    target: docs/constitution.md#c-001
  - role: amends
    target: docs/constitution.md#c-001-1
  - role: amends
    target: docs/constitution.md#c-001-2
  - role: amends
    target: docs/constitution.md#c-001-3
  - role: amends
    target: docs/constitution.md#c-001-4
  - role: amends
    target: docs/constitution.md#c-001-5
  - role: amends
    target: docs/constitution.md#c-004
  - role: amends
    target: docs/constitution.md#c-004-1
  - role: amends
    target: docs/constitution.md#c-004-2
  - role: amends
    target: docs/constitution.md#c-004-3
  - role: amends
    target: docs/constitution.md#c-005-4
  - role: amends
    target: docs/constitution.md#c-008
  - role: amends
    target: docs/constitution.md#c-008-1
  - role: amends
    target: docs/constitution.md#c-008-2
  - role: amends
    target: docs/constitution.md#c-008-3
  - role: amends
    target: docs/constitution.md#c-008-4
  - role: amends
    target: docs/constitution.md#c-009
  - role: amends
    target: docs/constitution.md#c-009-1
  - role: amends
    target: docs/constitution.md#c-009-2
  - role: amends
    target: docs/constitution.md#c-009-3
  - role: amends
    target: docs/constitution.md#c-009-4
  - role: amends
    target: docs/constitution.md#c-010
  - role: amends
    target: docs/constitution.md#c-010-1
  - role: amends
    target: docs/constitution.md#c-010-2
  - role: amends
    target: docs/constitution.md#c-010-3
  - role: amends
    target: docs/constitution.md#c-010-4
  - role: amends
    target: docs/constitution.md#c-010-5
  - role: amends
    target: docs/constitution.md#c-010-6
  - role: amends
    target: docs/constitution.md#c-011
  - role: amends
    target: docs/constitution.md#c-011-1
  - role: amends
    target: docs/constitution.md#c-011-2
  - role: amends
    target: docs/constitution.md#c-011-3
  - role: amends
    target: docs/constitution.md#c-011-4
  - role: amends
    target: docs/constitution.md#c-011-5
  - role: amends
    target: docs/constitution.md#c-011-6
  - role: amends
    target: docs/constitution.md#c-012
  - role: amends
    target: docs/constitution.md#c-012-1
  - role: amends
    target: docs/constitution.md#c-012-10
  - role: amends
    target: docs/constitution.md#c-012-11
  - role: amends
    target: docs/constitution.md#c-012-2
  - role: amends
    target: docs/constitution.md#c-012-3
  - role: amends
    target: docs/constitution.md#c-012-4
  - role: amends
    target: docs/constitution.md#c-012-5
  - role: amends
    target: docs/constitution.md#c-012-6
  - role: amends
    target: docs/constitution.md#c-012-7
  - role: amends
    target: docs/constitution.md#c-012-8
  - role: amends
    target: docs/constitution.md#c-012-9
  - role: amends
    target: docs/constitution.md#c-013
  - role: amends
    target: docs/constitution.md#c-013-1
  - role: amends
    target: docs/constitution.md#c-013-2
  - role: amends
    target: docs/constitution.md#c-013-3
  - role: amends
    target: docs/constitution.md#c-013-4
  - role: amends
    target: docs/constitution.md#c-014
  - role: amends
    target: docs/constitution.md#c-014-1
  - role: amends
    target: docs/constitution.md#c-014-2
  - role: amends
    target: docs/constitution.md#c-014-3
  - role: amends
    target: docs/constitution.md#c-014-4
  - role: amends
    target: docs/constitution.md#c-016
  - role: amends
    target: docs/constitution.md#c-016-1
  - role: amends
    target: docs/constitution.md#c-016-2
  - role: amends
    target: docs/constitution.md#c-016-3
  - role: amends
    target: docs/constitution.md#c-016-4
  - role: amends
    target: docs/constitution.md#c-016-5
  - role: amends
    target: docs/constitution.md#c-017
  - role: amends
    target: docs/constitution.md#c-018
  - role: amends
    target: docs/constitution.md#c-019
  - role: amends
    target: docs/constitution.md#c-020
  - role: amends
    target: docs/constitution.md#c-021
  - role: amends
    target: docs/constitution.md#c-022
  - role: amends
    target: docs/constitution.md#c-023
  - role: amends
    target: docs/constitution.md#c-024
---

# 宪法改为品味与底线，机制条款移入所属页面

宪法修订，日期 2026-10-31。

## 适用范围

Concord 自身的宪法，以及承接移出条款的页面：`docs/document-model.md`、`docs/architecture.md`、local-sdlc 的 `library.md` 与 `scope.md`、local-data-engine 的 `architecture.md`、project-onboarding 的 README 与工程页 `performance.md`。

## 理由

旧宪法多数条款在规定机制，只告诉人和 agent 不准做什么，没有说清这个项目认为什么是好的；规则写不到的地方，agent 只能按字面执行。维护者决定把宪法改为品味：用 8 条品味（C-017 至 C-024）说明判断标准、它们解决的问题与好坏对照，用底线（C-002、C-003、C-005、C-006、C-007、C-015）保留不得违反的硬约束。

## 影响

- 新增品味 C-017 至 C-024，总则改写为品味与底线的用法，新增 `general-taste` 与 `general-amend`。
- C-001、C-004、C-008 至 C-014、C-016 移出宪法。各款原文移入承接页面的同名小节，保持“必须 / 不得”的强度；C-005-4 移入 local-data-engine 的 architecture 页。
- Spec 页面与 Issue 中指向移出条款的链接改为指向对应品味或承接小节，Feature 的 Constitution 列表只保留品味与底线；Design 与 Research 是记录，保留原链接。
- 文件名、命令与错误码仍为 constitution；改名为 taste 的 Spec 与实现由后续变化完成。

## 来源

- `docs/constitution.md`
- `docs/document-model.md`
- `docs/architecture.md`
