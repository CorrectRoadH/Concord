# 文档模型

Concord 管理的文档按回答的问题分组。身份、类别、所属关系与名称由位置和一级标题决定；只有推导不出的语义写在 frontmatter，字段只在非空时出现。全部文件都可以直接编辑，Concord 从文件派生索引与反向关系，`concord check --since <base>` 检查变化是否合法（[事实归属](#事实归属)，[决策依据](design/sdd-core-model/DECISION.md)）。

| 分组 | 文档 | 位置 | frontmatter |
| --- | --- | --- | --- |
| Spec | Feature：README（能力）、`use-case/`（用户路径与验收）、`architecture.md`（实现）、`cli.md` 或 `library.md`（示例） | `docs/feature/<f>/` | 无 |
| Spec | Engineering：本仓库自身维护机制，结构同 Feature | `docs/engineering/<t>/` | 无 |
| 提案 | Roadmap：尚未采用的方向，结构同 Feature；实现与测试不指向它 | `docs/roadmap/<r>/` | 无 |
| 项目规则 | 品味、概念、写作政策 | `docs/constitution.md`、`docs/**/concepts.md`、`docs/**/concord-writing.json` | 品味只有 `status` |
| 决策记录 | Design：候选比较与正式选择 | `docs/design/<d>/` | 无；候选来自 `plans/`，选择来自 DECISION 的 `Selected:` 行 |
| 决策记录 | Research：带来源与观察时间的研究输入 | `docs/research/<r>/` | 无；观察日期与来源在正文 |
| 工作项 | Issue：缺陷、请求与观察 | `docs/issues/<i>.md` | `status`、`relations`、`source`、`closure` |
| 知识 | Memory：decision、insight 与 note | `memory/<m>.md` | `type`、`status`、`relations`、`supersededBy` |

`docs/` 下其它 Markdown 是普通文档，不是 owner。

## 身份

canonical 仓库相对路径是唯一身份。目录名与文件名是同类别内的短选择器，歧义时具名拒绝；名称取自正文唯一的一级标题，与路径 slug 可以不同，不超过 1024 个字符。名称保留 Unicode 原拼写与组合标记，大小写与 Unicode 规范化碰撞按路径保护规则拒绝。移动文件即改变身份，`check` 报告全部失效的精确引用。frontmatter 中的路径值是仓库相对路径。

## Issue

Issue 的 `status` 为 open 或 closed。`relations` 中参与生命周期裁决的关系带角色：`investigation`、`root-cause` 与 `decision` 指向 Memory，`adopts` 指向承接它的 Spec，`related` 指向另一个 Issue；重复关系只由 duplicate 关闭的 `canonical` 表达。远端来源的 `source` 保存 provider 的稳定身份与首次来源摘录，见 [Feedback](feature/feedback/architecture.md)。`closure` 的种类与必需字段见[本地观察](feature/feedback/use-case/manage-local-observations.md)；fixed 的修复核验见[修复缺陷](feature/local-sdlc/use-case/resolve-with-command-evidence.md)。普通正文链接只是导航。

## Memory

Memory 只保存可复用的知识与不需要 Design 的决策，不重复 Design 的结论；缺陷由 Issue 跟踪。`status` 为 captured、current 或 superseded：captured 表示尚未确认，note 只能是 captured，superseded 带 `supersededBy` 或写明原因与来源的 `supersession`。`relations` 的 `supports` 指向它支持的 Spec，`amends` 指向品味采用时的整份品味，或修订影响的条款与款。

## 格式边界

只有当前格式（[当前格式](architecture.md#当前格式)）。frontmatter 严格解码，未知字段与可推导字段都是无效输入。

发布与恢复使用 Git-private 的短发布租约与 journal 协议。读取使用乐观快照，提交短期独占；dry-run 不发布文件。无法解码的 journal 保留现场并阻断写入。

配置 `concord.config.ts` 可以不存在；存在时只声明 runner、测试与源码目录的覆盖、排除项与可选集成，见[维护项目配置](feature/project-onboarding/use-case/maintain-project-config.md)。

## 事实归属

每项事实只由自己的来源维护（[一件事只写一次，其余推导](constitution.md#c-019)）。

1. 每项事实只有一个 owner。Spec 正文由 Markdown owner 拥有；领域术语由 docs 下按目录归属的 `concepts.md` 拥有，写作政策由同目录的 `concord-writing.json` 拥有；测试定义与正向关系由测试源码拥有。Issue 拥有工作项的状态、关系与关闭结论，Memory 拥有知识的正文、类型、状态与关系；生命周期的文本历史在 Git。
2. 目录确定术语与政策的局部作用域，docs 根拥有全局定义。术语的定义与解释写在同一 `concepts.md`；其它 Markdown 链接到定义，不重复维护。
3. 反向关系、聚合索引与引用反查从来源派生，不维护第二份登记表。
4. 人与 Agent 直接编辑 `docs/` 与 `memory/` 下的文件，包括 Memory 与 Issue；索引、检索与反向关系由 Concord 从文件派生，不维护人工 INDEX。状态、关系与关闭结论的合法性由 `concord check --since <base>` 门禁检查，Concord 命令是执行需要运行的步骤的助手。

## 页面职责

Feature 的页面按读者的问题分工（[读得懂胜过写得全](constitution.md#c-017)）。

1. 行为页（Feature README、Use Case、cli、library）用使用者的语言声明输入、可观察结果、错误与约束。公开的输入输出结构、协议、机器可读字段、具名错误码、退出码，以及使用者可观察的持久化与恢复保证，属于行为页。行为页不写内部模块、内部数据结构、调用链和引擎选型。
2. 规范性陈述应能被测试断言。命令页给出完整调用、机器可读输出、退出码、具名错误与最小示例；API 页给出签名、返回值与失败。人读输出示例用于理解，可以规范化动态值，不保证逐字稳定（[机器可读输出](feature/local-sdlc/cli.md#机器可读输出)）。实现之前的示例标为预期输出；交付验收核对实际运行，运行记录进入 Memory，示例不作为运行证据。同一输出或错误定义只在一个行为页维护，其它页面链接引用。
3. architecture 与 lifecycle 页声明该 Feature 的内部实现：实体归属、数据流、不变量、失败阶段与资源生命周期。它们随实现修改，不重新定义行为。跨 Feature 的系统边界写在项目 `docs/architecture.md`。只改内部实现的修改不改行为页。
4. Roadmap 与 Feature 同体裁，表示尚未采用的方向，其示例均为预期输出。实现与测试不指向 Roadmap。
5. Feature 的页面分三类，各回答一个问题。README 与 cli、library 页是产品功能，像使用教程一样写谁用它、能做什么、怎么做；architecture 页是技术架构；Use Case 把功能连到用户旅程。README 给出用户价值、一个照着就能运行的上手示例和 Use Case 导航；输出字段、具名错误与退出码写在 cli 或 library 页，README 只链接它们。
6. 功能在不同情形下的不同表现写成 Use Case，不用子规则列表枚举。每个 Use Case 是一个情形下的用户旅程：起始状态、使用者的每步动作、要运行的命令或调用，以及这一情形下看到的输出。输入、状态或失败不同而表现不同时，另写一个 Use Case。
7. 文字难以说清的过程配图解。多方协作、状态迁移、时序和数据流程用 p5 动画演示，静态结构用 Mermaid。图解只演示页面已声明的规则，不新增规则，也不作为运行证据。

## 只写当前声明

声明式页面只写现在（[写现在，不写过去](constitution.md#c-020)）。

1. 约束用现行句式表达，只描述当前规则，不描述它与过去的差别，不点名已删除的接口、实现或文档。Design 的历史方案记录按裁决时的陈述理解，不因本款被解释为当前要求。
2. 实施日志、进度、待办、排障经过、测试运行记录、审阅与挑战经过、提交收据和 agent 交接不进入 `docs/`。排障经过、根因和可复用经验归 Memory，待调查的观察归 Issue，正式采用的目标归 Spec。Research 的研究事实、Design 的候选与裁决，以及记录类 owner 由工具维护的生命周期元数据，由各自 owner 保留，不借此记录实施日志、审阅经过或交接。本规则不授权删除或改写既有证据、来源及生命周期历史；Design 记录与 Spec 的分工见 [Design 记录](#design-记录) 至 [Design 记录](#design-记录)。
3. 声明式 owner（Feature、Use Case、Engineering、品味、`concepts.md` 与写作政策）只保存当前声明，不保存创建时间、采用来源、修订日期或修订历史。这些事实由 Git、Memory 或记录类 owner（Research、Design、Roadmap、Issue、Memory）保存，需要时派生。

## Design 记录

Design 是裁决时的方案记录，现行规则由 Spec 维护。

1. 已裁决 Design 的候选、共同约束、验收与裁决正文是裁决时的方案记录，不作为现行 Spec 的 owner。
2. 裁决时，选中方案中仍适用的要求完整写入相应的行为页、architecture 页或工程页；此后这些要求在 Spec 中维护，不因实现尚未满足而丢弃。
3. Design 不为追随实现改写历史方案。经授权的理由更正与内容组织调整，仍遵守已有的来源保留、身份与生命周期规则。
4. Spec 对 Design 的引用只用于导航或说明决策依据；链接目标的检查范围由 [documentation-quality 的聚合门禁](feature/documentation-quality/gate.md)声明。

## 术语与语言

一个词一个意思（[一个词一个意思](constitution.md#c-018)）。

1. Spec 页面用到的领域名词由生效范围内的 `concepts.md` 定义。一个概念只用它的 term 一种写法，不在中英两种写法之间切换；新名词先进入 `concepts.md`，再进入 Spec。
2. Spec 页面使用项目文档的主语言。命令、字段、错误码和代码标识写在行内代码中，不当作正文名词翻译或改写。
