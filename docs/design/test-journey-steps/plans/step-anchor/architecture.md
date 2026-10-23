# 列表项 anchor

## Entity Ownership

步骤由 Use Case 正文拥有；测试关联由测试标记拥有，代码关联由代码声明拥有。四种身份与 `Observation<T>` 直接引用[共同身份](../../共同身份.md)，候选不另定派生版本。

## 步骤与引用

仅从 Markdown AST 正文提取共同契约允许的步骤，不扫描字符串或 fence。验收条目按共同契约不得使用步骤语法；未标记项不进入步骤集合。无序、嵌套或其它 owner 中的步骤语法返回 `InvalidStepPosition`。步骤列表与章节语言无关。

每个步骤提取 `id / ref / ordinal / line`；ordinal 是所有合格项在文档中的展示顺序，从 1 计数，不采用作者所写的原始列表数字。ID 与标题显式 ID、slug 及折叠连字符的可接受别名一并做冲突检查，冲突为 `DuplicateAnchor`。

引用继续接受已存在的任意标题 anchor。视图分别展示步骤、整个 Use Case、非步骤 anchor；删除 ID 后拒绝悬空引用，由作者显式修改标记，不进行猜测重定向。Feature 与 supporting page 保留普通标题解析，不增加列表 anchor 解析路径。

## 书写与维护工具

步骤 ID 的书写、补齐和改名由 Concord 命令完成，作者不需要手工维护全部引用。三个命令都只处理单个 Use Case 的步骤，不处理文件移动或 Feature 改名。

| 命令 | 行为 | 写入 |
| --- | --- | --- |
| `concord use-case steps <use-case>` | 列出步骤的 ID、ordinal、行号、测试关联数与代码关联数，并列出根有序列表的 ordinal、行范围与是否含 ID | 只读 |
| `concord use-case format <use-case> [--seed --list <ordinal>]` | 为已含步骤 ID 的根有序列表补齐缺失 ID；`--seed --list` 为一个显式选择的未标记根有序列表建立步骤身份 | Use Case 正文 |
| `concord use-case rename-step <use-case> <old-id> <new-id>` | 改写正文中的 `{#old-id}`，以及全部指向 `<use-case>#<old-id>` 的源码标记与 Markdown 链接 | 正文、源码与文档 |

`format` 规则：

- 补齐的 ID 为 `step-N`。N 从当前文件已有 `step-N` 的最大值加 1 起逐项分配；没有时从 1 开始，并跳过标题显式 ID、slug、可接受别名与其它步骤占用的值。不维护已删除序号历史，不承诺序号永久不复用；仍被旧目标引用占用的 ID 不得分配给新步骤，所需引用扫描不完整时拒绝补齐。
- 已有 ID 不修改、不重排。作者需要可读名称时使用 `rename-step`。
- 规范化 ID 前的分隔：恰好一个空格，位于第一段末尾。位置错误的语法只报告 `InvalidStepPosition`，不移动文本。
- 默认只补齐已经包含步骤 ID 的根有序列表。为完全未标记的列表建立步骤身份时，必须同时指定 `--seed` 与 `--list`，显式选择一个根有序列表；列表 ordinal 与范围由 `use-case steps` 展示，并受当前正文前像保护。其它未标记列表保持不变；工具不按章节名称或正文语义猜测主流程。

`rename-step` 规则：

- `new-id` 必须符合步骤 ID 语法，且不与该文件的标题 anchor 或其它步骤冲突。
- 改写对象是精确引用 token：testRoots 中的 `@use-case` 标记、sourceRoots 中的 `@concord-implements`、`docs/` 中解析后指向旧引用的 Markdown 链接。
- 测试标记识别严格沿用 C-011 第 5 款：JS/TS 使用真实注释范围排除字符串、模板和正则中的伪标记；其它文本按既有注释前缀词法规则识别，不承诺判断其宿主字符串上下文。改名只替换已识别 Concord 标记的引用参数，不解析测试声明、框架绑定、回调或 skip/todo，也不启动 adapter 或 LSP。Markdown 使用 AST 排除代码示例，仅改写解析确认的链接目标；所需扫描不完整或无法可靠定位 token 时具名拒绝整次操作。
- Memory、Issue 与 Design metadata 中出现旧引用时拒绝执行，返回 `ManagedReferenceBlocked`，由对应生命周期命令处理。检查通过受管领域读取能力完成，不直接读取 owner 文件。
- 没有 `@name` 的测试标记，目标改变后测试引用随之改变；带 `@name` 的保持不变。两种情况的旧收据都不能用于新目标，结果中列出受影响的 case。

发布规则遵守 [C-003](../../../../constitution.md#c-003)：

- `format` 使用既有正文编辑的前像与 publication 契约。`rename-step` 在既有唯一 journal 与 publication lease 下增加专用 `step-rename` 授权范围，不串联多次 `source.set` 或文档发布。该范围绑定项目、worktree、冻结配置、Use Case 路径、old-id、new-id，以及完整文件前后像、摘要与 mode。
- 规划使用同一次乐观快照，记录引用扫描所需的文件、目录成员集合及受管引用检查；所需输入不完整时具名失败。提交取得短期独占 publication lease，复核配置、全部观察与完整变更集，并沿用 runner 失效和隔离检查。源码只允许改写配置范围内已识别标记的引用 token；Markdown 只允许改写目标步骤 ID 与解析确认的链接目标。禁止创建、删除或移动文件，禁止修改受管 metadata、Memory、Issue、配置和证据。
- 正常发布与恢复共用上述范围校验，并从前像复算允许的改写，拒绝超出授权的后像。沿用 prepared 回滚、committed 保留结果的恢复协议；未知编辑、配置变化或未知格式均保留现场。旧版本 CLI 不得降级处理该范围。
- 提交前发现冲突时零写入；发布开始后发生冲突或中断时返回 `RecoveryRequired`，保留唯一 journal，阻断普通当前事实读取和后续发布。恢复仅处理仍匹配前像或计划后像的文件，不覆盖未知编辑。`--dry-run` 执行同一规划与校验，不发布文件。

`check` 不要求每个根有序列表项都有 ID。`trace gaps` 列出含未标记根有序列表的 Use Case，作为书写提示，不产生 finding。

## 观察输入

依赖提供者返回共同契约的观察结构，其 value 包含 `scope: file | native-case`、测试关联 ID、可选原生集合与范围身份、已观察声明集合和执行边界。inputs 包含全部源码成员、源码字节、配置、解析实现与版本。

文件级 import 只能证明文件中的声明交集。直接和传递路径中的函数级、文件级声明均可记录；无法解析的辅助函数、动态派发、未声明实现、闭包深度与节点上限、跨进程及网络边界均加入 gaps。不能用 import 成功推断调用图完整。

## Data Flow

1. 当前正文与源码静态重建关系；check 的退出码、finding、complete 不读取观察。
2. 显式 `code analyze` 产生依赖观察；没有当前观察时视图报告 `not-observed` 与 `NoAnalyzer` 或 `SnapshotNotCurrent`。
3. 视图按共同契约匹配 step、use-case、feature 层级，只展示实际观察到的正向交集。文件范围的 `observed` 必须展示 `FileScope` 限定，不声称该文件每个 case 均调用了实现。
4. 未观察到目标交集一律为 `not-observed`，携带 gaps；只观察到其它 Feature 或同 Feature 的另一 Use Case 也不能推导行为无关。
5. 历史观察只带来源、时间展示，不用于当前判定。关联导航无需等待 adapter 或 LSP。

## Invariants

步骤视图、相关性判定和人工校准不写回契约或源码。没有匹配声明不是没有实现的证明；判定不产生 finding，不改变退出码。两条写作路径均剔除真实步骤的末尾 ID，代码示例保持代码处理语义。

## Errors

| 阶段 | code | 行为 |
| --- | --- | --- |
| 步骤位置 | `InvalidStepPosition` | check 报告错误位置 |
| 命名空间 | `DuplicateAnchor` | check 拒绝歧义 |
| 引用 | `AnchorNotFound` | 缺失目标须作者修复 |
| 观察 | gaps | 仅限制展示，不改变门禁 |

## Identity and Reuse

测试关联沿用共同契约的 v1；原生集合和 symbol locator 不进入关联 ID。带 name 的目标变化由 annotation 与 contract 摘要阻止旧证据复用。缓存有无不改变当前关系；可丢弃观察只能在显式命令后重新取得，不能承诺任意外部分析逐字相同。
