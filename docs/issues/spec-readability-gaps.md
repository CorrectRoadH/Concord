---
status: open
---

# 多数 Spec 页面尚未满足 C-016 的可读性与术语规则

## 现象

[C-017](../constitution.md#c-017) 要求 Feature README 面向第一次读的人、Use Case 主路径按教程写、复杂过程配图解、领域名词有定义且写法唯一。[本地 SDLC 闭环](../feature/local-sdlc/README.md)与[文档写作与领域术语](../feature/documentation-quality/README.md)已按该规则改写，其余页面仍有以下差距：

- README 仍以实现约束开头的 Feature 有九个：
  - cross-platform-release、document-packages、feedback
  - herdr-panel、local-data-engine、neutral-project-governance
  - portable-coordination、project-onboarding、web-workbench
- 不同情形下的表现仍用规则列表枚举，没有拆成 Use Case（[页面职责](../document-model.md#页面职责)）。例如[保护并恢复本地状态](../feature/local-sdlc/use-case/recover-local-state.md)用一张表列出四种情形，local-sdlc 的[范围与验收](../feature/local-sdlc/scope.md)和 documentation-quality 的[聚合门禁](../feature/documentation-quality/gate.md)是成串的子规则。
- 除上述两份 README 外，没有 p5 图解演示 Concord 自身的流程；唯一的其它 p5 图块用于演示[嵌入方式](../feature/web-workbench/use-case/embed-p5-sketch.md)。
- 英文写成的 Spec 页：portable-coordination 的 README、architecture 与 Use Case，以及 cross-platform-release 的 `cli.md`。

- `docs/_template` 已按 C-016 改写，随包模板 `templates/feature.md` 与 `templates/use-case.md` 仍是 Problem、Core Mental Model、Scope 的结构。`concord new` 生成的页面因此不引导作者写上手示例、图解和 Use Case 导航。

## 命令用词

第一次用的人看不懂命令在做什么（[C-017](../constitution.md#c-017)）。以下为待确认的替换建议，改动公开 CLI，确认后写入 Spec：

| 现在 | 实际做什么 | 建议 |
| --- | --- | --- |
| `constitution adopt`、`constitution amend` | 启用与修订宪法 | 取消，直接编辑，见 [Roadmap：写下项目的品味](../roadmap/taste/README.md) |
| `roadmap adopt` | 把方向移入 `docs/feature/` | `roadmap start` |
| `memory activate` | 把 captured 改为 current | `memory confirm` |
| `memory supersede` | 用新记录替代旧记录 | `memory replace` |
| `memory recall`、`issue recall` | 按关键词检索 | `search` |
| `memory index`、`issue index` | 摘要列表 | 并入 `list` |
| `test annotate`、`code annotate` | 生成可粘贴的标记 | `test marker`、`code marker` |
| `code locate --line` | 查某一行属于哪些代码声明 | `code at <path>:<line>` |
| `test collect` | 运行 adapter，记下原生测试清单 | `test discover` |
| `issue plan`、`issue execute` | 预览并执行远端 Issue 写入 | `issue sync --preview`、`issue sync` |
| `review render` | 生成审阅材料 | `review` |
| `design defer` | 暂缓裁决 | `design postpone` |
| `--expected-digest` | 防止覆盖读取后被别人改过的文件 | `--if-unchanged` |
| `PreimageChanged` | 文件在读取后被改过 | `FileChangedSinceRead` |

另外，`concord <命令> <子命令> --help` 打印的都是根命令的说明，看不出子命令做什么。

## 术语歧义

- 「发布」同时指写入的原子提交（publication）和软件发版（release），C-013 的标题与 cross-platform-release 使用同一个词。
- journal 与「恢复记录」并用，[保护并恢复本地状态](../feature/local-sdlc/use-case/recover-local-state.md)写「恢复记录」，architecture 页写 journal。
- 「用例」既指 Use Case，也指测试用例。
- 「注释」与[标记](../concepts.md#marker)、[代码声明](../concepts.md#code-declaration)并用。

## 机制缺口

全局 `concepts.md` 同时作用于英文 README、skills 与 templates。把 snapshot、lease 等英文写法列为中文概念的弃用名，会让英文文档的正常用法也被报告，所以这些写法暂不弃用，只在中文 Spec 正文里统一。方向见 [Roadmap：术语覆盖检查](../roadmap/terminology-coverage/README.md)。

## 期望

每个 Feature README 满足 [页面职责](../document-model.md#页面职责)，每个 Use Case 满足 [页面职责](../document-model.md#页面职责)，上述歧义各自定为一个概念并写入 `concepts.md`。

## 精简后待跟进的 Spec

文档模型已改为只描述现在：Design 只放未定的取舍，Issue 处理完删除，Memory 只放可复用经验，历史交给 Git，不再有变化门禁。以下页面仍按旧模型书写，需要按新模型改写：

- Issue 生命周期：feedback 的“本地观察”与 local-sdlc 的“核验修复并关闭缺陷”仍写 `status`、`closure` 与关闭种类；改为处理完删除，fixed 在删除前核验并输出结论。
- Memory 生命周期：`memory confirm`、`memory replace` 与 captured、current、superseded 状态不再需要。
- Design：“逐项比较方案并明确裁决” Use Case 与 `design decide`、`design postpone`、`design check` 仍按 Design 包书写；改为单页取舍。
- 代次：异步投影、工作区服务与发布协调中的代次（generation、epoch）概念与功能去掉。
- Herdr：herdr-panel 改为 Herdr mod，在 mod 内完成初始化空仓库与阅读全部文档等完整功能，不依赖外部 Web app。
- 没用的测试：`trace gaps` 列出没有关联 Use Case 的测试，需写入 local-sdlc 的 cli 页与 Use Case。
- 文件格式：写作政策 JSON、frontmatter YAML 与配置的形式可以重新设计。
