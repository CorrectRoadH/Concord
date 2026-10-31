# 术语覆盖检查

写作检查能抓住已知的旧名字，却抓不住新造的名字。AI 写 Spec 时最常见的问题恰恰是随手引入一个没定义的词，或者在中英两种写法之间来回切换。这个方向让 `concord check` 发现这两类问题，使 [C-016-4](../../constitution.md#c-016-4) 可以被检查，而不只靠审阅。

## 你可以做什么

- 看到 Spec 正文里反复出现、却没有在任何生效 `concepts.md` 中定义的名词，并决定把它定义为概念，或加入允许清单。
- 给弃用名限定路径：中文概念「租约」可以弃用 `lease`，但只在中文 Spec 目录生效，英文 README 与 skills 不受影响。

## 上手

以下为预期输出。某个 Feature 的正文五次写到 handoff，项目没有定义它：

```sh
concord docs check
```

```text
Documentation writing: failed (48 files)
docs/feature/cart/README.md:12 [undefinedTerm] handoff appears 5 times in selected Spec prose and no effective concepts.md defines it
```

把 handoff 定义为概念，或写进写作政策的允许清单后，检查通过。

## 怎样工作

- 候选名词：Spec 页面正文中、行内代码与代码块以外的 ASCII 单词和混合大小写词，出现次数达到政策阈值，且不是任何生效概念的 term。中文名词的切分不可靠，中文只通过弃用名约束。
- 允许清单与阈值写在 `concord-writing.json`，按目录合成，与禁词相同。
- 弃用名可以带 `roots` 与 `exempt`，含义与禁词的同名字段相同。
- Design、Research、Issue 与 Memory 是记录，不参与候选名词统计。

## 范围

包含：候选名词报告、允许清单、阈值和弃用名的路径限定。不包含：自动改写正文、按语言给一个概念维护多个 term、中文分词。
