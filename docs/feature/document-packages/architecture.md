# 文档目录与 Plan 入口的实现

本页声明文档目录的归属、Design 候选入口的解析与定案一致性，以及编辑期间聚合检查的重试实现。可观察行为见 [README](README.md)、[比较 Design 方案](../local-sdlc/use-case/compare-design-plans.md#候选内容布局)与[编辑期间的聚合检查](../documentation-quality/use-case/inspect-writing.md#编辑期间的聚合检查)。

## 目录归属

Research owner 是 `docs/research` 下主题目录的 README，附页不带 owner metadata，按最深的合法 owner 归属；嵌套 owner 截断祖先归属。顶层主题只从物理目录派生，不建立注册表（[决策依据](../../design/document-packages/DECISION.md)）。

## Plan 入口

Design 的 alternatives 拥有候选名称，`decision.selected` 保存名称；metadata 不登记入口路径（[决策依据](../../design/plan-content/DECISION.md)）。入口解析的输入是 Design 根、候选名与已观察的存在性：先观察 `plans` 目录及其直接成员，再判断文件类型与目录 README，按目录枚举的精确名称比较，大小写或 Unicode 规范化近似的名称不能替代声明名称。候选文件与入口 README 不带 owner frontmatter；入口有 frontmatter、错误类型或嵌套 owner 时拒绝。

document-layout、document-pages、design-content、documents、refs、repository 的 design codec、domain 与 template，以及 trace compiler 共用这一解析。候选节点发现、selectedPlan 投影、selector 提取、候选 manifest 校验与 README 导航都使用实际入口，派生关系指向实际入口。

工作台使用公共扫描产生的实际页面路径，不合成不存在的 README。单文件候选没有可选附页，按同一候选正文校验；目录候选检查模板必需入口和已出现的可选页组，自由嵌套页面不属于可选页组。缺失、歧义与未声明的 `plans` 直接子项进入全局 finding（`InvalidPlan`），不静默丢弃。

Design 外层的 page 操作不穿过 `plans` 边界；页面路径按[路径安全](../local-sdlc/architecture.md#路径安全)逐段验证，父目录由文件写入创建，不引入 Folder 实体。附件留在所属目录，Concord 不因扫描或 check 执行附件源码，不以 UTF-8 读写二进制附件。

## 定案一致性

定案门槛检查固定要求页与每个候选的实际入口。入口读取的观察包含 `plans` 目录本身，提交前重新验证完整成员、类型与额外 Markdown 字节；repository 入口在提交验证阶段同样比较完整路径集合。正文使用同内容 guard 重写，额外 Markdown 进入 changedPaths。附件成员变化参与目录观察，附件内容不声称经过语义校验。格式化只整理固定要求页和候选入口，不批量格式化拆分页面。

## 编辑期间的检查

目录观察记录路径、类型、大小与权限；扫描器可以按大小跳过文件，因此未读取文件的大小变化也参与观察。

公共 check 的每次尝试创建新的 LocalRepository，完整执行关系与写作检查后验证同一快照，并在下一次尝试前关闭缓存句柄与快照。只有来源观察产生的 `PreimageChanged` 与 `SourceChanged` 属于可重试漂移，不按异常消息匹配。检查成功或产生 findings 后都验证快照，findings 中已确认的 `SourceChanged` 也触发重试；普通格式错误先验证已观察快照，确有漂移才重试，否则返回原错误。权限、`UnsafePath` 与 `RecoveryRequired` 不被漂移覆盖。

快照核验先比较发布代次，再判断 journal；下一次尝试仍重新检查未完成 journal。新仓库遇到存活发布者的暂态现场时，只使用发布租约获取阶段的既有等待；无法证明有存活合作写者的 `RecoveryRequired` 立即失败。重试不用于写操作、runner、证据签发或 dry-run 写入。
