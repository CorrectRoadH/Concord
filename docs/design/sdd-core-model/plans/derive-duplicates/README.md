# derive-duplicates

## Problem

只删能推导的重复，不删推导不出的语义。身份、类别、所属关系与名称由路径和一级标题决定；生命周期状态、带角色的关系、远端来源的稳定身份、修复核验结论与授权边界仍显式保存，只是不再带空样板。删除收据存储，修复核验改为基于明确提交的强门禁，结论写进 Issue。

## Core Mental Model

| 分组 | 文档 | 显式保存的事实 |
| --- | --- | --- |
| Spec | Feature：README、`use-case/`、`architecture.md`、示例页 `cli.md` 或 `library.md`；Engineering 结构相同 | 无；全部由路径与一级标题推导 |
| 提案 | Roadmap：`docs/roadmap/<id>/`，体裁同 Feature，表示尚未采用的方向 | 无；采用是把目录移入 `docs/feature/` 的明确操作，测试与实现不得指向提案 |
| 项目规则 | 宪法、概念、写作政策 | 宪法的 `status`（draft 或 active），是采用授权的边界 |
| 决策记录 | Design：候选比较与正式选择；Research：带来源与观察时间的研究输入 | Design 的裁决仍由 `design decide` 校验后写入；Research 的观察日期与来源 |
| 工作项 | Issue：缺陷、请求与观察 | `status`、带角色的关系、远端来源身份、关闭结论；修复关闭带核验的提交 |
| 知识 | Memory：decision、insight、note | `type`、`status`（captured、current、superseded）与替代关系 |
| 关联 | 源码标记、测试标记 | 从源码派生 |

规则：

1. canonical 仓库相对路径是唯一身份。目录名与文件名是短选择器，歧义时具名拒绝；名称取自唯一的一级标题，与路径 slug 可以不同。移动即改变身份，检查报告全部失效的精确引用。
2. 能推导的字段不保存：`format`、`id`、`kind`、`title`、Use Case 的 `feature`、`createdAt`，以及空数组与空对象。
3. 推导不出的字段保存在 frontmatter，字段只在非空时出现。普通正文链接只是导航。
4. Memory Problem 并入 Issue：缺陷只在 Issue 中跟踪。Memory 只保存可复用知识与不需要 Design 的决策，不重复 Design 的结论。
5. 收据不再存储。修复核验在关闭前执行，结论（缺陷提交、修复提交与测试）写进 Issue，可审计、可重放。

详细机制见 [Architecture](architecture.md)，命令与工作方法见 [CLI](cli.md)。

## Scope

包含：上表的布局与字段、修复核验、配置默认与覆盖、命令面、宪法修订，以及本仓库一次性改写。

不包含：工作区服务；docsWork 保持现行。

接受的取舍：退休能力表中的四项；修复核验只支持线性路径；移动文件会使指向旧路径的引用失效，由检查报告。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-只有当前格式) | satisfied | 一次性改写，不保留旧读取 | 设计推理 |
| [L2](../../LIMITS.md#l2-修复经过核验且可审计) | satisfied | 线性路径下，缺陷候选与当前 HEAD 之间只允许产品文件变化，核验在关闭前执行，结论写入 Issue，可重放；其它路径返回 FixUnverifiable | 设计推理；待实现验收 |
| [L3](../../LIMITS.md#l3-工具写入保护前像) | satisfied | Concord 的写入（命令助手与 Web 保存）走 publication 与整文件摘要；直接编辑的可信度由 `check --since` 的门禁保证 | 设计推理 |
| [L4](../../LIMITS.md#l4-关系从来源派生) | satisfied | 正向关系只保存一次，反向关系派生 | 设计推理 |
| [L5](../../LIMITS.md#l5-声明式文档只写当前) | satisfied | Spec 无 frontmatter；宪法只有 status | 设计推理 |
| [L6](../../LIMITS.md#l6-不重复保存可推导的事实) | satisfied | 见规则 2 | 本仓库 164 个 owner 的 id 全部等于路径名 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-重复声明最少) | satisfied | Spec 每个 owner 的可推导字段从 5 个降为 0；改名只需移动文件并修正引用 | 现行 Feature 与 Use Case 的 frontmatter |
| [G2](../../GOALS.md#g2-每件事只有一个归属) | satisfied | 提案在 Roadmap，已采用在 Feature，缺陷在 Issue，设计决定在 Design，其它决策与知识在 Memory | 设计推理 |
| [G3](../../GOALS.md#g3-日常维护的步骤少) | partial | 全部文件直接编辑；修复缺陷少两步；顶层命令由约 30 个降为 24 | CLI 页的步骤表与统计 |
| [G4](../../GOALS.md#g4-零配置可用) | satisfied | 固定布局与发现默认；配置只用于 runner 与可选覆盖 | 设计推理；待 C1 验收 |
| [G5](../../GOALS.md#g5-检查与保证不变弱) | partial | 保留检查与授权；退休能力表列出明确放弃的四项 | 宪法修订提案 |

## Entry Points

- [Architecture](architecture.md)
- [CLI](cli.md)
