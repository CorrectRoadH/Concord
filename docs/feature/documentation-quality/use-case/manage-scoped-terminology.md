

# 管理按目录归属的术语与写作写作规则

领域术语由 concepts.md 拥有：每个概念有稳定局部 ID、唯一写法、定义段落与解释，旧写法列为弃用名称。全局与 Feature、Engineering 及其子目录可以分别声明；文件所在目录决定局部作用域。全项目视图自动汇总来源，不创建第二份登记表或把局部定义改成全局。

concepts.md 可以直接编辑，`concord check` 校验结构、作用域与被引用的定义；Concord CLI 与 Web 提供发现、读取、显式创建、摘要保护的修改和条目删除；导入与正文链接都指向原定义。弃用名称只在有效作用域派生检查，建议改为该概念的写法。局部写作规则不能扩大路径范围，不能静默覆盖全局定义；同名不同义在不同范围可并存，汇总保留出处。

规则发现、解析、有效作用域与检查共用实现；结构不合规、路径不安全、悬空引用、断开的正文链接及同作用域冲突不被静默忽略。写入和中断恢复遵守同一授权。定义与解释写在同一 concepts.md，其它 Markdown 链接到定义；工具不从其它文件推断定义。

验收涵盖全局/Feature/Engineering/嵌套目录、兄弟隔离、导入及删除保护、正文链接校验、结构错误、冲突、CAS 与原文字节保存、dry-run、伪造 journal 与恢复、构建 CLI 和真实 Web 的源码编辑/脏草稿保护。

作用域合成与来源格式见[文件格式与作用域](../policy.md)。

## 验收

- `docs/concepts.md` 定义 `## Issue {#issue}` 并弃用 `观察`：正文写「观察」时 `docs check` 报告禁词，建议 `Issue`，来源为 `docs/concepts.md#issue`；只写 `Issue` 计为使用，不报告 `unusedConcept`。
- 正文 `[Memory](../../concepts.md#memory)` 无 finding；fragment 改为 `#memo` 后 `check` 报告带路径与行号的 `AnchorNotFound`。删除仅被正文链接的概念可以写入，之后 `check` 报告断开的链接。
- 定义后的解释含链接与三级标题时结构合法，解释不计为使用，`show` 的 `definition` 只含定义段落；catalog 解释中写在行内代码里的弃用名不命中禁词。
- 没有 frontmatter、只有一级标题和两个概念的文件合法，`imports` 与 `deprecated` 为空。
- 以下输入各返回带行号与原因的 `InvalidConceptCatalog`：
  - 二级标题缺少 `{#id}`、标题含行内代码、标题后紧跟列表。
  - `deprecated` 指向不存在的 ID，或弃用名等于本文件 term。
  - frontmatter 含 `format` 或其它字段，以及无 `{#id}` 的二级标题。
- `concepts set` 保存的字节与提交内容相同；两个写者基于同一 digest 先后 set，后者得到 `PreimageChanged`，Web 保留草稿。
- 经 `concepts set` 删除仍被其它 catalog 导入的概念返回 `ConceptInUse` 并列出引用者，不写入；直接编辑删除同一概念后，`check` 报告 `DanglingConceptImport` 并退出 1。
- 直接编辑 concepts.md 写入缺少 `{#id}` 的二级标题后，`check` 报告带行号的 `InvalidConceptCatalog`；修正后通过。
- 两个兄弟目录各定义 term 为 `Job` 的概念时无诊断；一方导入另一方后报告 `AmbiguousConceptName`。全局与某个 Feature 的局部概念共存，局部政策越出所在目录被拒绝。
- 新仓库 `concord init` 只创建随包空 `docs/concepts.md`；concepts.md 以外的文件不定义概念。
- 保存后另一写者修改政策时保留草稿；prepared 或 committed 现场混入未知字节时拒绝恢复并保留现场。

Web 默认以左侧术语列表和右侧定义呈现全项目术语，支持按写法、定义及目录筛选，保留来源范围。选中术语后在右侧打开所属 concepts.md 源码并定位到该概念，实时显示结构诊断，保留显式保存；目录选择常驻左侧，省去重复的设置标题与下拉框；跨目录引用在编辑区维护。独立的「写作」入口承载规则配置和已保存文档检查。切换视图保留未保存草稿，切换范围及离开页面继续遵守草稿保护。

界面用词见[在 Web 管理写作规则与术语](manage-writing.md)。
