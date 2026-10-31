---
type: decision
status: current
relations:
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
    target: docs/constitution.md#c-012-10
  - role: amends
    target: docs/constitution.md#c-010-3
---

# 新增 C-016：Spec 先让第一次读的人读懂

宪法修订，日期 2026-10-31。

## 适用范围

Concord 自身与接入项目的 Spec 页面：Feature README、Use Case、cli 与 library 页、architecture 页、工程页与 docs 顶层页面。Design、Research、Issue 与 Memory 是记录，不受 C-016 约束。

## 理由

Concord 要解决两个问题：Spec 写完没人看得懂，AI 随意造词和换词。复查发现项目自身偏离了这两个目标。Feature README 写成了实现约束清单，开头就是字段、退出码、读取边界和性能预算。全局术语表只有 Spec、Memory、Issue 三个概念，Feature、Use Case、owner、投影、租约、快照等高频名词没有定义，且中英写法混用。p5 图解能力已经完整，但除演示嵌入方式的 Use Case 外，没有一张图解释 Concord 自己的功能。部分 Feature 页用英文写成，与其它中文 Spec 不一致。

## 影响

- C-016-1 至 C-016-5：新增可读性、图解、术语与语言规则，适用于 Concord 自身与接入项目的 Spec 页面。
- C-010-3 与 C-012-10：聚合门禁的规则移到 documentation-quality 的支持页 `gate.md`，链接目标随之更新，规则不变。
- 已有页面不自动满足新规则。local-sdlc 与 documentation-quality 的 README 先按新规则重写作为样板；其余页面的差距记录在 Issue `spec-readability-gaps`，未定义名词的检查方向记录在 Roadmap `terminology-coverage`。

## 来源

- `docs/feature/local-sdlc/README.md`
- `docs/feature/documentation-quality/README.md`
- `docs/concepts.md`
- `docs/feature/web-workbench/use-case/embed-p5-sketch.md`
