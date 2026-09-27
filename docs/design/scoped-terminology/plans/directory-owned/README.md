# directory-owned

## Problem

领域术语与写作政策需要明确作用域、严格结构与唯一来源。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-scope-and-identity) | satisfied | 目录拥有范围，聚合不复制定义 | 架构约束；不代表实现验收 |
| [L2](../../LIMITS.md#l2-publication-and-recovery) | satisfied | 操作/路径双向校验、CAS 和持久依赖摘要 | 架构约束；不代表实现验收 |
| [L3](../../LIMITS.md#l3-explicit-transition) | satisfied | 显式替换政策并修订 c-001 | 架构约束；不代表实现验收 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-local-ownership) | satisfied | 定义与使用范围归属一致 | 方案分析 |
| [G2](../../GOALS.md#g2-safe-authoring) | satisfied | 共用领域入口和摘要保护 | 方案分析 |

## 来源识别与作用域

只识别 docs 下精确命名的 `concepts.json` 与 `concord-writing.json`，排除 `docs/_template` 及任何 `.git`、`node_modules` 路径段。`docs/concepts.json` 是全局定义，`docs/concord-writing.json` 是全局政策，其它目录的文件作用于其后代文件。docs 之外的政策文件不获得受管写入权限。

`--rules` 仍可显式读取安全的仓库相对外部政策；局部受管作用域不能越出所在目录。全局 roots 可省略，默认为 docs，也可以显式包含仓库内其它文档根。局部 roots 可省略，默认为所在目录，显式值必须在该目录内。路径均为仓库相对路径，不静默重定基准。

祖先与全局政策按范围合成：禁词累加；长度阈值与概念使用选项只由显式提供的值替换；兄弟作用域互不泄漏。同一有效范围内同一弃用写法给出不一致的首选输出时，报告携带双方来源的具名冲突。等价规则合并命中，但保留全部来源。

目录缺失、路径不安全或发现的文件格式错误都返回具名错误，不静默跳过。目录成员关系、全部输入字节与配置进入检查快照摘要，并在结束时复核。

## 格式

写作政策采用 `concord.writing/v2`，概念只来自按目录拥有的 JSON catalog，Markdown 表格不是运行时术语来源。普通检查遇到 v1 返回 `WritingMigrationRequired`，show 暴露原文与 digest 供显式替换。扫描器处理 Markdown 与 MDX 正文。

概念 catalog 采用 `concord.concepts/v1`：`format`、`concepts` 与可选 `imports`。每个概念有 slug 形式的 `id`、非空 `definition`，以及按语言分组的 `preferred`、`aliases`、`deprecated` 名称，至少一种语言。

ID 在 owner 内唯一，身份为 canonical catalog path#id；来源中不重复保存 scope 或索引字段。同一条目内的首选、别名与弃用写法在同一规范化规则下互不重叠。兄弟作用域可以有同名写法；有效范围内的歧义产生诊断，不静默合并或覆盖。限定引用显示全部同名概念及其作用域。只有弃用名称产生禁词，首选名与别名计入使用。

## 适用与引用

全局与祖先 catalog 自动适用于后代文档，全局概念也适用于显式的全局扫描根。`imports` 在局部作用域复用一个显式指定的概念，只解析目标 catalog 直接拥有的定义，不递归导入。

引用须经校验；删除或改名被引用定义的写入会被阻止，不另建关系登记表。聚合列出全部来源 catalog、条目与诊断，不把聚合结果写回 `docs/concepts.json`，也不扩大其适用范围。可选的只读 Markdown 渲染是投影，Web 是主要聚合视图。

## 工具入口

JSON show 区分 missing、valid、invalid，返回原文与 digest；不安全路径是失败。公开 action 为 `writing.index/show/set/check` 与 `concepts.index/show/set`，path 默认全局。set 是整 owner CAS，创建时 digest 为 null，返回实际提交的来源、digest 与收据。

CLI 对应命令接受 `--path`、`--body`、`--expected-digest` 与 `--dry-run`，不提供隐式编辑或删除。删除条目通过引用检查后的 catalog set 完成。`docs check` 默认按项目有效作用域检查，`--rules` 显式选择；存在局部政策或 catalog 时不要求根政策。

init 只在路径缺失时创建空的全局 `concepts.json`，保留已有内容。`docs/concepts.md` 是可选的解释性正文，不包含标准术语表。

## Web

Web `/writing` 选择作用域，通过安全目录输入创建局部政策或 catalog，编辑禁词与概念定义、名称、别名和弃用名，只读列出继承与聚合条目及其来源，支持筛选与搜索。

作用域切换与写入沿用草稿与 CAS 导航保护，保存响应的 baseline 不能采用未见过的刷新版本。检查绑定已保存快照，丢弃过期的异步响应。概念与政策编辑使用同一工具 API。

## 发布与恢复

发布与恢复都按精确文件名与路径、操作以及唯一非空且经校验的变更对称授权。init 的例外只限于全局空 `concepts.json`，并绑定正常的配置初始化事务。

概念引用校验和目录观察在发布前完成；恢复按需校验完整的前后视图，不向外扩展。错误的操作、任意 JSON、删除、额外文件、symlink、配置漂移与未知编辑都在写入前拒绝。v1 政策 journal 返回迁移或冲突错误，不静默升级；此类事务先用匹配的 CLI 恢复。

## 宪法修订

c-001 声明领域术语由按目录拥有的 JSON 拥有，Markdown 拥有解释性正文与其它契约正文。支撑用的 schema JSON 是受治理的一等 owner，派生索引只读。c-003、c-009、c-012 的含义不变，迁移不改写证据。

## 定案规则

### 1. 选择与应用分离

默认扫描选择全部已发现政策的 roots 并集（局部省略时为所在目录，全局为 docs），加上没有同目录政策的 catalog 目录。局部 owner 因此可以在窄的全局选择之外启动扫描，但不能越出自己的目录。

对被选中的文件，全局与祖先政策都生效，与由哪个 owner 选中无关。政策 roots 只负责选择文件，单条禁词的 roots 与 exempt 只限制该规则，局部 roots 不取消祖先规则。没有政策的空 catalog 选择其目录；没有可读文档的空目录返回具名的无输入错误。

显式受管 `--rules` 只选择该政策的 roots，但在选中文件上合成全部适用的政策与 catalog，包括后代，不扩大到其它作用域。显式非受管 `--rules` 是独立只读 profile：选择它的 roots（默认 docs），只使用它自身与按目录的 catalog，不合成已发现政策。报告写明模式与选中的 roots。只有 catalog 的仓库可以检查；没有任何来源时返回 `WritingPolicyNotFound`。

### 2. 匹配与冲突

ASCII 整词写法忽略大小写并使用词边界，非 ASCII 写法按字面精确匹配。别名校验、有效名称碰撞与规则检查使用同一套规范化与匹配器，不依赖 locale。canonical 概念引用对继承与导入路径去重。

冲突检测基于实际选中文件的适用性，包括禁词的 roots、exempt 与 allowIn；互不相交的豁免或作用域不构成冲突。某处命中的适用约束对首选输出不一致，或禁止了另一个适用概念的首选名或别名时，报告带来源的冲突，不任意选择替换建议。两个有效概念拥有相同规范化首选名或别名时，在重叠范围内报告歧义并保留双方引用。

兼容的禁词可以按文件、位置、规范化词与替换建议去重，但必须保留全部来源，并先按各自规则判断豁免。同一来源重复的禁词仍被拒绝。catalog 别名不产生隐式禁词。数字阈值可以为 null 以清除继承，省略表示继承，布尔 false 表示关闭；roots 只负责选择，不可为 null。

### 3. 使用统计

使用按 canonical 概念统计，范围是该定义有效（全局、祖先或直接导入）的选中正文文件。只有首选名与允许别名计入，弃用名称不证明正确使用。导入计为原定义的有效使用，兄弟目录的同名定义不计。

至少一个适用文件启用检查、且在其有效文件中没有找到有效使用时，每个定义最多报告一次 unusedConcept。定义本身、JSON catalog 与生成的聚合视图不计入正文使用。快照包含全部 catalog 与政策字节、Markdown 与 MDX 成员、配置以及选中文档内容，不包含 SVG 与 CSS。

### 4. catalog 写入与依赖守卫

set-concepts 的发布与 dry-run 在同一快照中读取全部已发现 catalog 的成员与原文，叠加目标写入后的内容，检查目标的 imports，并阻止删除或改名被其它有效 catalog 引用的定义。另一个 catalog 格式错误导致反向引用无法确定时，目标中原本有效的定义不能删除。

格式错误的目标可以显式修复，修复后已知的有效导入者必须仍能解析。无关的格式错误或悬空 catalog 保持诊断，不阻止增量修复，但 check 与 index 不把它们报告为正常。设置 catalog 不需要解析写作政策。

只有 set-concepts 在 journal 中保存 catalog 依赖守卫：除目标外每个已发现 catalog 的排序 canonical 路径与原文摘要。预检（包括重启后）核验精确成员与摘要；新增、删除或修改导入者返回 `RecoveryConflict` 且不写入。其它操作拒绝该字段。守卫无法省略已知路径，因为精确成员会被核对。

发布按当前依赖与 CAS 校验计划写入。prepared 恢复校验严格的非空写入后内容与未变的依赖守卫，再恢复精确的写入前字节（可以为 null 或格式错误），不要求写入前内容可解析。committed 恢复检查同样的依赖与目标写入后内容，保留已提交字节。直接导入只指向已识别的 catalog 路径与其直接拥有的 ID，没有递归导入。writing/v1 journal 在变更前拒绝恢复。

### 5. 迁移与初始化

迁移是作者审阅后经当前工具的显式替换，不是自动推断的转换器：show 取得 v1 原文与 digest，用 concepts.set 以 catalog CAS 写入定义、别名与弃用名，再用 writing.set 以政策 CAS 写入 v2。concepts.set 检查 catalog 依赖而不解析写作政策，因此 v1 不会阻断迁移。

迁移期间普通检查返回 `WritingMigrationRequired`，writing.index 与各 show 的修复路径照常工作。每个无效 owner 在上述引用保护下可以独立修复。迁移不编造定义，不自动决定弃用名。

init 只在 `docs/concepts.json` 缺失时添加它：写入前为 null，内容为不含 imports 的严格空 catalog，并绑定真实的 init 事务与新配置。init 不为局部 catalog 或写作政策提供例外，已有全局 catalog 按字节保留，包括无效内容。恢复与普通发布执行相同的例外规则，任意额外 JSON 都不被允许。

### 6. Web 状态绑定

前端状态与响应绑定到 kind、path 与请求世代，不只绑定 digest。切换作用域触发未保存保护，A 的过期响应不能更新 B。政策与 catalog 各有独立的已保存 baseline，保存其中一个不会把另一个标为干净。

写入返回精确提交的 owner 与 digest。刷新只在 path、kind、digest 与世代都相同时更新 baseline，否则保留草稿并提示外部变更。概念变化或继承来源的外部变化使对应关系失效；检查界面始终描述某次输入快照并显示实际作用域与模式。浏览器测试覆盖 A→B 延迟响应、一次保存成功一次冲突，以及继承 catalog 的外部修改。

### 同一概念的跨语言同名

同一 canonical 概念可以在 en 与 api 等语言列复用相同的首选名或允许名称，聚合与检查按概念身份去重。每列内部重复仍被拒绝，允许与弃用语义集合不能跨语言相撞，同一弃用名也不能产生不一致的首选建议。
