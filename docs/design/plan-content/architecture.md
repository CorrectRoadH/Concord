# Plan 内容与当前检查

## 身份与入口

Design owner 的 alternatives 继续拥有候选名称；decision.selected 保存该名称。每个名称恰好对应 plans/<name>.md 或 plans/<name>/README.md。两种入口同时存在返回 AmbiguousDesignPlan；二者都不存在返回 DesignPlanNotFound。候选文件不带 owner frontmatter。目录形式下允许嵌套 Markdown 和附件，普通子目录 README 不产生新 owner。

同名文件与目录同时存在即歧义，包括空目录。README 是不区分大小写的保留候选名。入口比较基于目录枚举的精确名称；大小写或 Unicode 规范化近似名称不得替代声明的名称。入口解析先观察 plans 目录及其直接成员，再判断文件类型与目录 README；错误类型和名称碰撞具名拒绝。

物理路径继续是精确引用身份。改变存储形式时，作者必须同时更新相对链接、DECISION 选择链接及精确路径消费者；工具不静默重定向旧引用。decision.selected 名称保持不变。创建默认维持目录形式；本轮不新增自动搬迁或重写链接命令。作者可以通过 Git 编辑使用文件形式。

已定案候选也允许仅调整内容组织形式，保留 decision 的名称、理由、时间和目标；此操作不构成重新裁决，精确路径引用仍须由作者迁移。遗漏引用由当前检查报告，不伪造历史证据。

所有消费者共用入口解析，输入为 Design 根、候选名与已观察的存在性。派生关系指向实际入口；不得在 metadata 新增路径注册表。文件形式的 Goals/Limits 链接为 ../GOALS.md 和 ../LIMITS.md；目录形式为 ../../GOALS.md 和 ../../LIMITS.md。DECISION 链接必须指向实际入口。

repository 的候选节点发现、selectedPlan 投影、selector 提取、候选 manifest 校验和 README 导航全部使用实际入口。单文件候选没有可选附页，使用同一个候选正文校验；目录候选继续检查模板必需入口和已出现的可选页组。工作台以实际 Markdown 路径展示与编辑，不合成不存在的 README。未声明的 plans 直接子文件或目录不成为候选，也不得作为 Design 支持页绕过声明；当前检查报告 InvalidPlan。入口有 frontmatter、错误类型或嵌套 owner 时明确拒绝。

自由嵌套页面不属于模板 manifest 的可选页组。共用解析覆盖 document-layout、document-pages、design-content、documents 和 refs。repository 的 design codec/domain/template 和 trace compiler 也采用该解析；工作台采用公共扫描产生的实际页面路径。缺失或歧义进入全局 finding，不能静默丢弃。

## 页面与附件

Design 的 page add/show/set 接受安全 Unicode 相对 Markdown 路径。--plan 选择候选，README 别名指向实际入口。文件形式只拥有自身正文，添加支持页返回 DesignPlanRequiresDirectory；作者先显式改为目录形式。Design 外层的 page 操作不得穿过 plans 边界。路径逐段验证，拒绝绝对路径、dot segment、反斜杠、symlink、碰撞及嵌套 metadata owner。父目录由文件写入创建，不引入 Folder 实体。

Design 支持页的结构化引用解析回 Design owner，并验证候选范围；不得因此扩大 test/code 的允许目标种类。Markdown 保持 page 编辑与 anchor 语义。附件保留在所属目录，通过项目工具链生成；Concord 不因扫描或 check 执行附件源码。本轮不新增附件发布、二进制编辑或渲染服务。

## 定案一致性

既有定案门槛继续检查固定要求页与每个候选的实际入口。额外 Markdown 属于同一 Design 的声明内容，其字节和目录集合必须在定案提交前保持一致。附件成员变化参与目录观察；附件内容不声称已被语义校验或纳入裁决证据。为附件字节提供新的二进制发布 guard 属于单独能力，不以 UTF-8 读写二进制附件。

入口读取观察包含 plans 目录本身，提交前重新验证其完整成员和类型。正文使用既有同内容 guard 重写，额外 Markdown 也进入 changedPaths。repository 入口同时在提交验证阶段比较完整路径集合；格式化保持原有范围。

格式化只整理既有固定要求页和候选入口，不批量格式化拆分页面。普通 check 检查入口唯一性与引用归属，不把方案论证当成已执行验证。

## 编辑中的 check

目录观察继续记录路径、类型、大小与权限。扫描器可以按文件大小跳过输入，因而未读取文件的大小变化也可能影响检查集合，不能删除这一保护。错误说明区分目录输入变化与作者写入冲突；安全路径与类型校验每次执行。

公共 check 的每次尝试创建全新 LocalRepository，完整执行关系与写作检查，再验证同一快照。仅重试已确认的来源漂移，最多三次，每次失败后等待 50 毫秒。每次尝试在下一次开始前关闭缓存句柄与快照；失败尝试不输出结果、不设置进程退出码。成功结果保持现有 JSON 结构。

第三次仍漂移时返回 SourceChanged，说明检查尚未完成。RecoveryRequired、权限、格式及安全错误立即返回。重试不用于任何写操作、runner、证据签发或 dry-run 写入。持续变化不能保证产生当前一致结论，不能回退到历史投影或跳过检查。CLI 与结构化 check action 采用同一个重试操作。

仅来源观察产生的 PreimageChanged 及 SourceChanged 属于可重试漂移；不按异常消息模糊匹配。检查成功或产生 findings 后均须验证快照，findings 中已确认的 SourceChanged 也触发重试。检查抛出普通格式错误时先验证已观察快照：来源确有漂移则重试，否则返回原错误。权限、UnsafePath 和 RecoveryRequired 不被漂移覆盖。发布租约的既有等待只作用于获取阶段。耗尽时 SourceChanged 保持非零退出，写命令继续使用 PreimageChanged；公开错误契约由文档质量 Use Case 拥有。

同一次快照核验先比较发布代次，再判断 journal；代次变化代表本次读取已失效，下一次创建新仓库仍须重新检查未完成 journal，不能把遗留现场当作成功。新仓库创建遇到存活发布者的暂态现场时，只按既有发布获取等待机制处理；无法证明有存活合作写者的 RecoveryRequired 立即失败。

稳定来源只执行一次检查；漂移最多额外两次完整检查及总计 100 毫秒退避。性能对照按工程性能契约的同机冻结消费者和七次交错样本进行；重试不是降低当前输入完整性要求的许可。编辑器留下 symlink 或稳定的半成品格式仍是错误。

## 影响与取舍

本方案增加候选存储形式与 Design 支持页解析，是跨模块契约变更，须独立设计挑战。单文件与目录歧义显式失败，避免优先级掩盖数据。保持 metadata 格式与默认创建形式；不要求已有目录方案迁移。只读 check 的短暂编辑重试保持 C-003、C-004 的当前事实下限，不修改宪法。

## 验收

隔离 Git 消费者覆盖两种候选混用、非 ASCII 名称、文件与目录歧义、缺失入口、错误精确引用、嵌套页面 CAS、逃逸与 symlink、单文件支持页拒绝、CLI/action/repository 定案及派生关系。真实文件变更覆盖未读取文件大小变化、已读取正文变化、目录成员增删、重试后成功及连续漂移耗尽。写入的过期 digest 仍失败，未完成 journal 不重试为成功。使用构建与打包后的公开 CLI，并完成 pnpm check。
