---
status: closed
closure:
  kind: fixed
  reason: check 校验 docs 下全部行内宪法链接：指向不存在 ID 的链接报告带路径与行号的 AnchorNotFound 并退出 1
---

# 正文中断开的宪法链接通过 check

## 现象

在 Feature 正文写入指向不存在条款的链接 `[C-099](../../constitution.md#c-099)`，`concord --json check` 仍返回 `ok: true`，没有 finding。

## 复现

1. 在已接入的仓库中，向任意 Feature README 正文末尾追加 `见 [C-099](../../constitution.md#c-099)。`
2. 运行 `concord --json check`。

## 期望

Spec [功能开发遵守并修订项目宪法](../docs/feature/project-onboarding/use-case/evolve-constitution.md) 要求宪法引用有稳定目标，删除或变更能被诊断。断开的链接应产生带路径与行号的 finding，`check` 退出 1。

## 影响范围

本仓库 27 个文件共 100 处正文链接指向宪法，均不受校验；只有元数据 `constitutionRefs` 被校验。修复方案见 Design `constitution-structure`。

## 原记录信息

```yaml
createdAt: 2026-10-23T04:29:14.033Z
epoch: 0
evidenceRequirement: command
history:
  - at: 2026-10-29T02:32:31.363Z
    action: resolve
    reason: check 校验 docs 下全部行内宪法链接：指向不存在 ID 的链接报告带路径与行号的 AnchorNotFound 并退出 1
    resolution:
      reason: check 校验 docs 下全部行内宪法链接：指向不存在 ID 的链接报告带路径与行号的 AnchorNotFound 并退出 1
      at: 2026-10-29T02:32:31.363Z
      epoch: 0
      kind: fixed
      evidenceLevel: command
      red: ccev_07fd688c51d2bb3076bc6682c7483d52
      green: ccev_33d2918629469279722867274d865bd4
      selectedCaseId: neref_7b56d124f14ea8922a96156d1b397990
resolution:
  reason: check 校验 docs 下全部行内宪法链接：指向不存在 ID 的链接报告带路径与行号的 AnchorNotFound 并退出 1
  at: 2026-10-29T02:32:31.363Z
  epoch: 0
  kind: fixed
  evidenceLevel: command
  red: ccev_07fd688c51d2bb3076bc6682c7483d52
  green: ccev_33d2918629469279722867274d865bd4
  selectedCaseId: neref_7b56d124f14ea8922a96156d1b397990
```
