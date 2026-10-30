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
| [L1](../../LIMITS.md#l1-只有当前格式) | satisfied | 一次性改写 | 设计推理 |
| [L2](../../LIMITS.md#l2-修复经过核验且可审计) | not-satisfied | 只要求标记存在，关闭与核验分离；关闭提交与父提交不是可靠的红绿基线 | sdd-model-review R1、R2 |
| [L3](../../LIMITS.md#l3-工具写入保护前像) | not-satisfied | 未定义 Web 与 action 的受管保存及裁决、宪法采用的授权 | sdd-model-review R5 |
| [L4](../../LIMITS.md#l4-关系从来源派生) | satisfied | 正文链接派生 | 设计推理 |
| [L5](../../LIMITS.md#l5-声明式文档只写当前) | satisfied | Spec 无 frontmatter | 设计推理 |
| [L6](../../LIMITS.md#l6-不重复保存可推导的事实) | satisfied | 全部推导 | 设计推理 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-重复声明最少) | satisfied | Spec 与记录都按约定推导 | 设计推理 |
| [G2](../../GOALS.md#g2-每件事只有一个归属) | partial | 提案并入 Feature 后，已采用与未采用混为一类（审查 R3） | sdd-model-review R3 |
| [G3](../../GOALS.md#g3-日常维护的步骤少) | satisfied | 顶层命令 16 个 | CLI 页 |
| [G4](../../GOALS.md#g4-零配置可用) | partial | 全部 Git 跟踪文件发现会误认 vendor 与示例标记，漏掉未跟踪测试（审查 R6） | sdd-model-review R6 |
| [G5](../../GOALS.md#g5-检查与保证不变弱) | not-satisfied | fixed 可未经核验成立；关系角色、远端身份、写入与采用授权被删除（审查 R1、R4、R5） | sdd-model-review |

## Entry Points

- [Architecture](architecture.md)
- [CLI](cli.md)
