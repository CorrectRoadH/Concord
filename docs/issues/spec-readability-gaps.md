---
status: open
---

# 多数 Spec 页面尚未满足 C-016 的可读性与术语规则

## 现象

[C-016](../constitution.md#c-016) 要求 Feature README 面向第一次读的人、Use Case 主路径按教程写、复杂过程配图解、领域名词有定义且写法唯一。[本地 SDLC 闭环](../feature/local-sdlc/README.md)与[文档写作与领域术语](../feature/documentation-quality/README.md)已按该规则改写，其余页面仍有以下差距：

- README 仍以实现约束开头的 Feature 有九个：
  - cross-platform-release、document-packages、feedback
  - herdr-panel、local-data-engine、neutral-project-governance
  - portable-coordination、project-onboarding、web-workbench
- 不同情形下的表现仍用规则列表枚举，没有拆成 Use Case（[C-016-2](../constitution.md#c-016-2)）。例如[保护并恢复本地状态](../feature/local-sdlc/use-case/recover-local-state.md)用一张表列出四种情形，local-sdlc 的[范围与验收](../feature/local-sdlc/scope.md)和 documentation-quality 的[聚合门禁](../feature/documentation-quality/gate.md)是成串的子规则。
- 除上述两份 README 外，没有 p5 图解演示 Concord 自身的流程；唯一的其它 p5 图块用于演示[嵌入方式](../feature/web-workbench/use-case/embed-p5-sketch.md)。
- 英文写成的 Spec 页：portable-coordination 的 README、architecture 与 Use Case，以及 cross-platform-release 的 `cli.md`。

- `docs/_template` 已按 C-016 改写，随包模板 `templates/feature.md` 与 `templates/use-case.md` 仍是 Problem、Core Mental Model、Scope 的结构。`concord new` 生成的页面因此不引导作者写上手示例、图解和 Use Case 导航。

## 术语歧义

- 「发布」同时指写入的原子提交（publication）和软件发版（release），C-013 的标题与 cross-platform-release 使用同一个词。
- journal 与「恢复记录」并用，[保护并恢复本地状态](../feature/local-sdlc/use-case/recover-local-state.md)写「恢复记录」，architecture 页写 journal。
- 「用例」既指 Use Case，也指测试用例。
- 「注释」与[标记](../concepts.md#marker)、[代码声明](../concepts.md#code-declaration)并用。

## 机制缺口

全局 `concepts.md` 同时作用于英文 README、skills 与 templates。把 snapshot、lease 等英文写法列为中文概念的弃用名，会让英文文档的正常用法也被报告，所以这些写法暂不弃用，只在中文 Spec 正文里统一。方向见 [Roadmap：术语覆盖检查](../roadmap/terminology-coverage/README.md)。

## 期望

每个 Feature README 满足 [C-016-1](../constitution.md#c-016-1)，每个 Use Case 满足 [C-016-2](../constitution.md#c-016-2)，上述歧义各自定为一个概念并写入 `concepts.md`。
