# convention-first

## Problem

Spec 由 Feature 组成，每个 Feature 有固定的四种页面；此外只需要项目规则、决策记录、工作项与知识，以及从源码派生的关联。本候选按这一分类重建模型：位置决定类别与身份，一级标题决定名称，正文链接表达关系，Git 保存历史。Spec 文档没有 frontmatter；记录类文档只保留它们独有的状态。

## Core Mental Model

| 类别 | 文档 | 位置 | 元数据 |
| --- | --- | --- | --- |
| Spec | Feature：README（能力）、`use-case/`（用户路径与验收）、`architecture.md`（实现）、示例页 `cli.md` 或 `library.md`（调用与输出） | `docs/feature/<feature>/` | 无 |
| Spec | Engineering：本仓库自身维护机制的 Feature，页面结构相同 | `docs/engineering/<topic>/` | 无 |
| 项目规则 | 宪法、概念、写作政策，适用于所有 Feature | `docs/constitution.md`、`docs/**/concepts.md`、`docs/**/concord-writing.json` | 无 |
| 决策记录 | Design | `docs/design/<id>/`：README、GOALS、LIMITS、CASES、DECISION、`plans/<候选>/` | 无；候选来自 `plans/` 的子目录，裁决来自 DECISION 的 `Selected:` 行 |
| 决策记录 | Research | `docs/research/<topic>/README.md` | 无；观察日期与来源写在正文 |
| 工作项 | Issue | `docs/issues/<id>.md` | `status`，关闭时 `closure` |
| 知识 | Memory | `memory/<id>.md` | `type`（decision、insight、note），被替代时 `supersededBy` |
| 关联 | 源码标记、测试标记、运行收据 | 源码与测试文件；收据在 Git-private 目录 | 从源码派生 |

由此得到四条约定：

1. 身份就是路径。类别由所在目录决定，名称由一级标题决定，Use Case 属于所在目录的 Feature。
2. 关系就是正文链接。Issue 指向 Memory、Memory 指向 Spec、Spec 引用宪法条款，都写成正文中的链接，由检查器解析与派生反向关系。
3. 历史在 Git。创建时间、修改历史与采用经过从 Git 取得，文件只写当前。
4. 未实现的方向就是没有测试的 Feature。不另设 Roadmap 类别；`trace gaps` 列出尚未验证的 Use Case。

缺陷只在 Issue 中跟踪，修复时写一个指向它的回归测试；修复前失败、修复后通过由 Git 复现，不保存收据。Memory 只保存知识。

详细机制见 [Architecture](architecture.md)，命令与工作方法见 [CLI](cli.md)。

## Scope

包含：上表的布局与元数据、零配置默认、检查规则、命令面与工作方法，以及本仓库与接入项目改写到新格式。

不包含：工作区服务与测试执行机制。

接受的取舍：Roadmap 与 Memory Problem 两个类别被删除，收据、证据等级与 epoch 一并删除，现有内容改写为 Feature 与 Issue；Spec 的写入不再经由 Concord 命令，前像保护只覆盖 Concord 自己的写入；命名必须与路径一致，文件名即 ID。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-只有当前格式) | satisfied | 一次性改写全部文件，不保留旧读取路径 | 设计推理 |
| [L2](../../LIMITS.md#l2-修复可以复现) | satisfied | 回归测试以标记指向 Issue；`test verify` 在修复提交与父提交上复现失败与通过，不存储收据 | 设计推理；待实现验收 |
| [L3](../../LIMITS.md#l3-工具写入保护前像) | satisfied | Concord 的写入（脚手架、Issue 关闭、Memory 替代、宪法 Decision）仍走 publication；人工编辑由 Git 与编辑器负责 | 设计推理 |
| [L4](../../LIMITS.md#l4-关系从来源派生) | satisfied | 关系取自正文链接与标记，元数据中不再保存关系列表 | 设计推理 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-每个事实只声明一次) | satisfied | 路径、一级标题、正文链接与 Git 各承担一类事实 | 本仓库 164 个 owner 的 id 全部等于路径名 |
| [G2](../../GOALS.md#g2-分类少而不重叠) | satisfied | 五类文档，Roadmap 并入 Feature，Problem 并入 Issue，Memory 只存知识 | 设计推理 |
| [G3](../../GOALS.md#g3-编辑-spec-不需要专用命令) | satisfied | Spec 无元数据，直接编辑；命令面见 CLI 页，顶层 10 个 | 设计推理 |
| [G4](../../GOALS.md#g4-零配置可用) | satisfied | 布局固定；标记在全部 Git 跟踪文件中发现；配置只保留 runner 等真实选择 | 设计推理；待 C1 验收 |
| [G5](../../GOALS.md#g5-检查不变弱) | pending | 现有检查按新来源改写；正文链接取代元数据关系后，需确认悬空、放置与证据检查全部保留 | 待实现验收 |

## Entry Points

- [Architecture](architecture.md)
- [CLI](cli.md)
