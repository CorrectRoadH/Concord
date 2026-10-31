# 把测试关联到 Use Case 步骤

## 场景

作为测试维护者与 reviewer，我希望把测试和实现关联到 Use Case 主流程中的一个具体步骤，看到每个步骤由哪些测试与代码声明关联，并发现没有关联的步骤。

## 主流程

1. 作者按[步骤语法](#步骤语法)在主流程的根有序列表项第一段末尾写 `{#id}`，或运行 `concord use-case format <use-case>` 为已含 ID 的列表补齐缺失 ID。为未标记列表建立步骤时，先运行 `concord use-case steps <use-case>` 查看列表，再使用 `--seed --list <ordinal>` 显式选择一个列表。 {#declare-steps}
2. 测试写 `@use-case <path>#<id>`，实现写 `@concord-implements <path>#<id>`。`concord check` 校验步骤位置、ID 命名空间与引用目标；已有标题 anchor 和整个 Use Case 的关联继续有效。 {#link-declarations}
3. `concord use-case steps <use-case>`、`trace show` 与 `review` 按步骤列出测试与代码声明，另列整个 Use Case 和非步骤 anchor 的关联。没有关联的步骤单独列出；`trace gaps` 提示含未标记项的根有序列表。 {#inspect-associations}
4. 步骤改名使用 `concord use-case rename-step <use-case> <old-id> <new-id>`，在一个可恢复的变更集中改写正文、源码标记与 Markdown 链接。`--dry-run` 预览同一规划与校验；Issue 与 Memory 关系中的引用须先由作者修改。 {#rename-step}

## 步骤语法

- 步骤是 Use Case 正文中 Markdown 根节点直接拥有的有序列表项，第一段末尾带至少一个空格及 `{#id}`。解析不依据章节名称或正文语义；没有该语法的列表项不是步骤。ordinal 是合格项在文档中的展示顺序，从 1 计数，不采用作者所写的列表数字。
- 作者只对主流程步骤使用该语法，验收、场景与异常说明不得使用。合法位置上的该语法都按步骤解析，工具不发现误标；`use-case steps` 展示全部步骤供审阅。
- `{#id}` 出现在无序列表项、嵌套列表项、Feature 或附页中时，`check` 报告 `InvalidStepPosition`。代码 fence、行内代码与 HTML 中的 `{#id}` 不是步骤。
- ID 语法与文档名相同，按原始 Unicode 拼写精确匹配，不做大小写折叠、Unicode 归一化或 slug 转换，例如 `{#拒绝过期令牌}`、`{#reject-token}`。ID 与同文件标题 anchor 共用命名空间，与标题显式 ID、slug 或折叠连字符后的别名冲突时报告 `DuplicateAnchor`。
- `@use-case <path>#<anchor>` 继续接受任意已存在的标题 anchor。删除步骤 ID 后悬空引用报告 `AnchorNotFound`，由作者修改标记，工具不猜测重定向。
- 两条写作检查路径都剔除真实步骤末尾的 ID；步骤视图与相关性判定不写回 Spec 或源码。`check` 不要求每个根有序列表项都有 ID。

身份与观察规则见[关联身份与观察](../library.md#关联身份与观察)。

## 补齐与改名

`use-case steps <use-case>` 只读，列出步骤的 ID、ordinal、行号、测试与代码关联数，以及每个根有序列表的 ordinal、行范围与是否含 ID。

`use-case format <use-case>` 只为已含步骤 ID 的根有序列表补齐缺失 ID：

- 补齐值为 `step-N`，N 从已有 `step-N` 的最大值加 1 起逐项分配，没有时从 1 开始；跳过标题显式 ID、slug、别名、其它步骤与旧引用仍占用的值。序号不保证永久不复用；所需引用扫描不完整时拒绝。
- 已有 ID 不修改、不重排。规范化后 ID 前恰好一个空格，位于第一段末尾；位置错误的语法只报告 `InvalidStepPosition`，不移动文本。连续运行第二次零写入。
- 为完全未标记的列表建立步骤身份须同时给出 `--seed` 与 `--list <ordinal>`，显式选择一个根有序列表并受当前正文前像保护；选择缺失或无效时返回 `InvalidStepList`。其它未标记列表不变，工具不按章节名称猜测主流程。

`use-case rename-step <use-case> <old-id> <new-id>` 在一个变更集中改写正文的 `{#old-id}` 以及全部指向 `<use-case>#<old-id>` 的精确引用：

- `new-id` 须符合步骤 ID 语法，且不与该文件的标题 anchor 或其它步骤冲突。
- 改写对象是 testRoots 中的 `@use-case` 标记、sourceRoots 中的 `@concord-implements`，以及 `docs/` 中解析后指向旧引用的 Markdown 链接。标记识别遵守 [关联由源码声明拥有](../library.md#关联由源码声明拥有)，JS/TS 字符串、模板、正则与 Markdown 代码示例中的相同文本不变；不解析测试声明，不启动 adapter 或 LSP。扫描不完整或无法可靠定位 token 时拒绝整次操作。
- Issue 与 Memory 的 frontmatter 关系或正文链接中出现旧引用时返回 `ManagedReferenceBlocked`，零写入，由作者直接修改或用对应命令处理。
- 没有 `@name` 的测试标记随目标改变测试引用，带 `@name` 的保持不变；结果列出受影响的 case。
- 只改写已识别的引用 token、步骤 ID 与链接目标，不创建、删除或移动文件，不改 frontmatter、Memory、Issue 与配置。提交前冲突零写入；发布开始后冲突或中断返回 `RecoveryRequired`，`recover` 回滚 prepared、保留 committed 结果，遇到未知编辑拒绝并保留现场。`--dry-run` 执行同一规划与校验，不发布。

改名与补齐只处理单个 Use Case 的步骤，不处理文件移动或 Feature 改名。发布范围见[步骤改写的发布](../architecture.md#步骤改写的发布)。

## 验收

以构建打包后的 CLI 在隔离 Git 消费者中验证，步骤导航与依赖观察分别验收，使用已知正误声明的直接调用与子进程样本逐个公开观察结果和缺口，不设未知结果比例目标：

- 不同语言章节下带 `{#reject-token}` 的顶层有序项可导航；整个 Use Case 与已有标题的关联保留并分组展示；缺失 ID 报告引用 finding。
- 改步骤文字、插入或移动其它项，步骤引用不变，只有 ordinal 变化。三个步骤两个有测试时列出未关联步骤，`check` 不失败；没有步骤的 Use Case 不产生 finding。
- 无序项、嵌套项、附页中的步骤语法报告 `InvalidStepPosition`，代码示例中的 `{#id}` 不生成步骤；未标记的验收列表不进入步骤视图。
- 直接调用样本观察到同一步骤声明时为 `observed`、level 为 `step`；另一 case 导入的声明、辅助函数转调或只有其它 Feature 声明时不冒充该 case 的行为证明；构建 CLI 子进程、HTTP 边界、没有分析器或达到闭包上限时为 `not-observed` 并给出原因。
- 冷、热、损坏与清空缓存时 `check` 的当前关系、finding、退出码与 `complete` 一致。错误原生标签且没有 Concord 标记时不产生关联。
- 带 `@name` 的标记从文件改为步骤目标时 ID 保持。
- `format` 只给缺失项补 `step-N`；删除最大序号后不分配被标题或旧引用占用的值。`rename-step` 改写测试、代码与文档链接并列出受影响 case；规划后修改任一输入时零写入；在首个文件发布后和 committed journal 持久化后中断，由第二个 CLI 恢复时分别回滚与保留；受管引用阻断时零写入。

## 步骤分组输出

`trace show --json` 的 `stepGroups` 按 Use Case 分组，包含 `steps`、`wholeUseCase`、`nonStepAnchors` 与 `unassociatedSteps`。每个关联组的 `relevance` 按 `testId` 返回当前观察的 `scope`、判定和缺口；步骤同时保留声明数量。

组级 `observation.result` 在任一测试观察到交集时为 `observed`，否则为 `not-observed`；`gaps` 合并各测试的限制。没有可用分析时返回 `NoAnalyzer`。组级结果不表示所有步骤或测试均已观察到交集，也不证明执行或覆盖。

历史投影中的相关性不授权当前输入。读取历史投影时，已有观察降为非当前，相关性返回 `not-observed` 与 `SnapshotNotCurrent`；当前结果需通过 fresh 读取复核输入。
