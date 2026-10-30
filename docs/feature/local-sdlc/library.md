# 领域与数据所有权

## Owner

Feature 与 Use Case 拥有当前产品 Spec；Engineering 拥有仓库维护机制；Research 保存带时间的决策输入；Design 保存候选与唯一裁决；Roadmap 保存方向和采用历史；Memory 保存 Problem、Decision、Insight 及其生命周期。测试源码拥有 case 身份和正向关系，Git 保存它们的演进。

Feature、Use Case 与 Engineering 是声明式 owner（[C-012](../../constitution.md#c-012-11)）：frontmatter 只有 `format`、`id`、`title`、`kind` 与可选的 `description`，Use Case 另有所属 `feature`。`title` 是不超过 1024 个字符的单行文本。创建时间从 Git 派生；Feature 由哪个 Roadmap 采用，由该 Roadmap 的 `adoptedAs` 声明，trace 以 `adopted-as` 边的反向关系呈现。Research、Design、Roadmap、Memory 与 Issue 是记录，保留 `createdAt` 与各自的生命周期字段。

## 派生关系

`@feature` 或 `@use-case` 用 canonical 路径指向对应 Spec，`@regression` 可重复指向 Problem。每个标记块恰有一个 Spec 目标，同一 Spec 可有多个测试。执行引用由文件路径与测试名称自动派生，测试名称只描述行为，不携带机器 ID；不提供人工分配 ID 或先分配再关联的步骤（[决策依据](../../design/annotation-case-identity/DECISION.md)）。Spec 不反写测试列表，trace 每次从 owner 和源码重新编译反向关系。

## 关联身份与观察

| 身份 | 形式 | owner |
| --- | --- | --- |
| 步骤 | `<use-case path>#<step-id>`，见[步骤语法](use-case/link-tests-to-steps.md#步骤语法) | Use Case 正文 |
| 测试关联 | `concord.test-reference/v1`：文件加 `@name`，或文件加 Spec 目标与标记序号 | 测试源码标记 |
| 代码关联 | JS/TS 为 `concord.code-reference/v1` 派生引用；其它语言为 canonical 文件路径加文件内标记块序号 | 代码声明 |
| 原生选择 | adapter 观察到的原生 ID 集合 | 无，执行时观察 |

前三种身份不随缓存变化；原生选择只影响执行与收据。带 `@name` 的标记改变 Spec 目标时测试关联 ID 不变，但 annotation 与 Spec 摘要改变，旧收据不能用于新目标。原生选择与 symbol locator 不进入关联身份；原生清单是否存在不改变 case 集合、case ID 或 `check` 的关系结论。原生标签（pytest mark、JUnit Tag 等）只作展示元数据，标签中的 Spec 字符串不创建关联，也不参与引用校验。

原生清单、依赖分析与相关性判定返回同一观察结构：`value`、`inputs`（全部实际输入的摘要，含实现与版本）、`complete`、`gaps`（`complete` 为 false 时的具名原因）、`observedAt` 与 `current`（输入摘要与当前源码一致）。

- 只有 `test collect`、`code analyze` 与 `test run` 的执行前收集产生观察；其它命令与编辑器服务只读取。
- 观察可丢弃。`check` 的退出码、finding 与 `complete` 不读取观察，冷缓存、热缓存、缓存损坏与清空后结论相同。
- `current` 为 false 的观察只作历史展示，带来源与时间，不用于选择执行或相关性判定。

相关性判定只报告观察到的正向交集，不输出“无关”结论：

| 结果 | 含义 |
| --- | --- |
| `observed` | 测试依赖中观察到声明实现目标的代码，带 `level`：`step`、`use-case` 或 `feature`；文件范围的结果同时带 `FileScope` |
| `not-observed` | 未观察到这样的代码，总带 `gaps`，例如 `FileScope`、`DepthLimit`、`NoSourceImports`、`SubprocessBoundary`、`NoAnalyzer`、`SnapshotNotCurrent` |

`not-observed` 不表示测试与 Spec 无关；CLI、review 与工作台写作“未观察到交集”并列出原因。只观察到其它 Feature 或同 Feature 另一 Use Case 的实现也不推出无关。判定不产生 finding，不改变退出码，关联与观察都不证明执行、断言正确或覆盖率，不用于 fixed。文件级 import 只能证明文件中的声明交集，不证明该文件每个 case 都调用了实现（[决策依据](../../design/test-journey-steps/DECISION.md)）。

## 私有状态

通过 `git rev-parse --git-path concord` 定位的 HawDB、evidence 和 journal 属于当前 worktree；普通单 worktree 仓库通常落在 `.git/concord`，linked worktree 则使用自己的 Git-private 路径。缓存可清除重建；证据绑定定义、Spec、候选内容和 runner 配置；journal 只用于安全恢复，不取代 Markdown 或测试源码。

## 边界

所有不可信 JSON、YAML 和缓存内容必须严格解码。路径拒绝绝对路径、traversal 与 symlink 逃逸，读取检查的实现见[路径安全](architecture.md#路径安全)。通用模式只承诺 command evidence，不继承任何产品专属 E2E 可靠性声明。
