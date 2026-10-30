# 文档模型

Concord 管理的文档按回答的问题分组。身份、类别、所属关系与名称由位置和一级标题决定；只有推导不出的语义写在 frontmatter，字段只在非空时出现。全部文件都可以直接编辑，Concord 从文件派生索引与反向关系，`concord check --since <base>` 检查变化是否合法（[C-001](constitution.md#c-001-5)，[决策依据](design/sdd-core-model/DECISION.md)）。

| 分组 | 文档 | 位置 | frontmatter |
| --- | --- | --- | --- |
| Spec | Feature：README（能力）、`use-case/`（用户路径与验收）、`architecture.md`（实现）、`cli.md` 或 `library.md`（示例） | `docs/feature/<f>/` | 无 |
| Spec | Engineering：本仓库自身维护机制，结构同 Feature | `docs/engineering/<t>/` | 无 |
| 提案 | Roadmap：尚未采用的方向，结构同 Feature；实现与测试不指向它 | `docs/roadmap/<r>/` | 无 |
| 项目规则 | 宪法、概念、写作政策 | `docs/constitution.md`、`docs/**/concepts.md`、`docs/**/concord-writing.json` | 宪法只有 `status` |
| 决策记录 | Design：候选比较与正式选择 | `docs/design/<d>/` | 无；候选来自 `plans/`，选择来自 DECISION 的 `Selected:` 行 |
| 决策记录 | Research：带来源与观察时间的研究输入 | `docs/research/<r>/` | 无；观察日期与来源在正文 |
| 工作项 | Issue：缺陷、请求与观察 | `docs/issues/<i>.md` | `status`、`relations`、`source`、`closure` |
| 知识 | Memory：decision、insight 与 note | `memory/<m>.md` | `type`、`status`、`relations`、`supersededBy` |

`docs/` 下其它 Markdown 是普通文档，不是 owner。

## 身份

canonical 仓库相对路径是唯一身份。目录名与文件名是同类别内的短选择器，歧义时具名拒绝；名称取自正文唯一的一级标题，与路径 slug 可以不同，不超过 1024 个字符。名称保留 Unicode 原拼写与组合标记，大小写与 Unicode 规范化碰撞按路径保护规则拒绝。移动文件即改变身份，`check` 报告全部失效的精确引用。frontmatter 中的路径值是仓库相对路径。

## Issue

Issue 的 `status` 为 open 或 closed。`relations` 中参与生命周期裁决的关系带角色：`investigation`、`root-cause` 与 `decision` 指向 Memory，`adopts` 指向承接它的 Spec，`duplicate-of` 指向另一个 Issue。远端来源的 `source` 保存 provider 的稳定身份与首次来源摘录，见 [Feedback](feature/feedback/architecture.md)。`closure` 的种类与必需字段见[本地观察](feature/feedback/use-case/manage-local-observations.md)；fixed 的修复核验见[修复缺陷](feature/local-sdlc/use-case/resolve-with-command-evidence.md)。普通正文链接只是导航。

## Memory

Memory 只保存可复用的知识与不需要 Design 的决策，不重复 Design 的结论；缺陷由 Issue 跟踪。`status` 为 captured、current 或 superseded：captured 表示尚未确认，note 只能是 captured，superseded 带 `supersededBy` 或写明原因与来源的 `supersession`。`relations` 的 `supports` 指向它支持的 Spec，`amends` 指向宪法修订影响的条款与款。

## 格式边界

只有当前格式（[C-009](constitution.md#c-009-1)）。frontmatter 严格解码，未知字段与可推导字段都是无效输入。

发布与恢复使用 Git-private 的短 publication lease 与 journal 协议。读取使用乐观快照，提交短期独占；dry-run 不发布文件。无法解码的 journal 保留现场并阻断写入。

配置 `concord.config.ts` 可以不存在；存在时只声明 runner、测试与源码目录的覆盖、排除项与可选集成，见[维护项目配置](feature/project-onboarding/use-case/maintain-project-config.md)。
