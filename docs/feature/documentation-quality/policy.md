# 按目录声明术语与写作政策

```text
docs/
  concepts.md                      # 全局概念定义
  concord-writing.json             # 全局写作政策，init 创建预设
  feature/payments/
    concepts.md                    # payments 的局部概念
    concord-writing.json           # payments 的局部规则
    examples/concord-writing.json  # 更小的目录范围
  engineering/build/
    concepts.md                    # build 的局部概念
```

Concord 识别 docs 下精确命名的 concepts.md 与 concord-writing.json，排除 docs/_template、.git 和 node_modules。目录决定作用域，不在来源中重复保存 scope。其它文件不获得这两类写入授权；聚合从来源派生，不回写全局文件。全局概念与局部概念均有来源路径，局部定义不会自动升级为全局。

## 概念定义

```markdown
---
format: concord.concepts/v2
imports:
  - docs/concepts.md#memory
deprecated:
  feedback: [工单]
---

# 支付术语

本页定义支付流程中的术语。

## 反馈 {#feedback}

等待调查的产品或工程观察。

反馈关闭后，关联的 [Memory](../../concepts.md#memory) 仍保留调查结论。旧称 `工单` 只在行内代码中出现。
```

每个二级标题是一个概念：去掉 `{#id}` 后的标题文字是该概念唯一的写法（term），id 在本文件内唯一，完整身份为 canonical catalog path#id。标题后的第一个段落是定义，定义之后、下一个二级标题以前的内容是解释。一级标题恰好一个，位于所有概念之前；两者之间是页面引言。没有二级标题的文件是空 catalog。

frontmatter 严格解码：format 必填；imports 可选；deprecated 可选，键为本文件的概念 ID，值为弃用名列表。term 只能是纯文本。同一文件内 term 互不重复，弃用名互不重复且不等于任何 term。ASCII 写法按忽略大小写和单词边界匹配，其它写法按字面匹配。结构不合规返回 `InvalidConceptCatalog`，消息带行号与原因。

全局和祖先目录的定义自动适用；imports 可显式引用其它目录的直接定义，例如 docs/feature/payments/concepts.md#payment。引用不递归导入另一文件的 imports，也不复制定义。移除或改名被导入的 ID 会被拒绝。不同兄弟目录的同名概念可以并存；有效范围相交的歧义携带双方来源，不静默覆盖。

正文可以链接到定义，例如 `[反馈](../payments/concepts.md#feedback)`。fragment 不是该 catalog 的概念 ID 时，`concord check` 报告 `AnchorNotFound`，类别为 relation。链接的筛选与解码规则与宪法链接相同。正文链接不阻止删除定义；断开的链接由检查报告。

catalog 只能由 concepts 工具写入；author set、page set、page add 与 Web 通用保存遇到 catalog 路径返回 `ManagedConceptCatalog`。格式与取舍见[术语格式设计](../../design/markdown-terminology/plans/markdown-owned/README.md)。

## 写作政策

```json
{
  "format": "concord.writing/v3",
  "bannedTerms": [
    {"term": "旧称", "use": "推荐表达", "why": "避免歧义", "exempt": ["docs/feature/payments/history"]}
  ],
  "sentenceLength": 140,
  "paragraphLength": 320,
  "unusedConcepts": true
}
```

roots 可省略：全局默认为 docs，局部默认为所在目录。全局 roots 可显式选择仓库其它文档目录；局部 roots 不得越出所在目录。所有路径均为仓库相对路径，不自动按文件位置重新解释。

默认 `concord docs check --json` 选择全部政策 roots，加上没有同目录政策的概念目录；因此局部 owner 可以启动被全局窄 roots 排除的目录扫描。没有政策也可以检查概念。没有任何相关来源时具名报错；明确选中的根没有文档时也不静默通过。`concord check` 的聚合门禁范围见 [Feature](README.md#聚合门禁)。

选文件与应用规则是两个步骤。对已经选中的文件，全局和祖先政策共同生效；roots 不取消祖先约束，单条禁词的 roots/exempt/allowIn 只限制它自身。禁词累加，长度和概念使用选项采用最近目录的显式值：省略表示继承，数字阈值的 null 表示清除，布尔 false 表示关闭。

`--rules` 指向受管政策时，仅用该政策的 roots 选文件，仍合成这些文件的祖先与后代政策。指向非受管路径时是独立只读 profile，仅用显式政策与有效概念，不合成其它写作政策。报告说明实际模式和选择范围。

冲突按实际适用的文件与表达位置判断，互不相交的 roots/豁免不构成冲突。相同命中可去重，但必须保留全部适用来源；冲突命中不任意挑选一条替换建议。一个概念的弃用名等于另一个有效概念的 term，或禁词禁止了有效概念的 term，也须报告。

## 使用统计与输入快照

概念使用按完整概念身份统计，只读取该概念实际适用的所选正文。只有 term 算使用，弃用名称不证明正确使用；显式 import 是原概念的有效使用。catalog 文件整份不算使用，生成汇总也不算。catalog 仍参与禁词与长度检查，解释中提到弃用名时写在行内代码中。同一概念最多产生一条 unusedConcept 诊断，不用兄弟目录的同名概念替它证明使用。


报告绑定政策、概念、文件集合、配置、正文和 CSS 的输入摘要；读取期间变化则拒绝结果。Web 只展示某次已保存输入的历史快照，不称为当前通过。

## 工具管理与恢复

通过 writing 与 concepts 工具及 Web 编辑来源，使用完整 owner 摘要保护修改。show 区分 missing/valid/invalid，安全读取的无效原文可以显式修复；危险路径和读取失败不会伪装为空态。正文输入可来自临时文件或 stdin，不直接绕过工具改受管来源。concepts set 按提交的字节保存 Markdown，不重新序列化。

publication 与 recovery 双向校验精确路径、具名操作、唯一有效 after 和配置绑定。concepts 写入还保存其它 catalog 的完整集合与原文摘要（操作名 `set-concepts`）；事务中断后新增、删除或修改 importer 会拒绝恢复并保留现场。prepared 恢复精确 before（包括原来的无效 bytes），committed 保留已提交内容，不要求 before 已经符合当前 Schema。

init 只在缺失时把 docs/concepts.md 创建为随包空 catalog，并绑定真实的新配置初始化；保留已有 docs/concepts.md 的全部字节，即使它不是合法 catalog。这个例外不允许局部 catalog、非空定义或任意 Markdown 混入 init，init 不创建 concepts.json。

## 从 writing/v1 迁移

普通检查遇到 v1 返回 WritingMigrationRequired，不自动解释旧概念表。先用 show 获取旧政策原文与 digest；作者审核概念定义与弃用名，为每个概念选定唯一写法，用 concepts.set 保存 concepts.md；最后用 writing.set 和旧政策 digest 显式替换为 v3。迁移中间阶段仍明确拒绝旧政策检查。

catalog 编辑不依赖写作政策解析，因此 v1 政策不会阻断迁移。各无效来源可逐项修复，但已知引用不能被破坏。迁移不从名称自动编造 definition，也不把旧表的其它名称自动当成 deprecated。

升级前若存在 v1 journal，先用匹配的旧 CLI 完成恢复；新运行时不暗中恢复旧事务或改写其证据。详细合成、修复及恢复条件见[采用方案](../../design/scoped-terminology/plans/directory-owned/README.md)。

## 从 concepts/v1 迁移

docs 下存在任何 concepts.json 时，`concepts index/show`、`docs check` 与 `concord check` 返回 `ConceptMigrationRequired`，complete 为 false，并列出全部 v1 路径。运行时不解析 v1 内容。

路径变化会同时改变全部 imports，因此迁移是一次覆盖全部 v1 catalog 的事务：

```sh
concord concepts migrate --draft --language zh > /tmp/concepts-migration.json
concord --dry-run concepts migrate --input /tmp/concepts-migration.json
concord concepts migrate --input /tmp/concepts-migration.json
```

`--draft` 只读：用指定语言的 preferred 作为 term，复制定义与该语言的 deprecated，把 imports 改指 concepts.md；其它语言名称与 aliases 列在 `unplaced` 中由作者处理。`--language` 必填。

输入的每项包含 legacyPath、legacyDigest、path、expectedDigest 与 body。输入必须恰好覆盖全部 v1 catalog，摘要都是当前值，path 为同目录的 concepts.md，body 为合法 v2，迁移后的 catalog 集合没有无效来源或悬空导入。已有的同名解释页按 expectedDigest 显式替换。

事务操作名为 `migrate-concepts`，写入每个 concepts.md 并删除对应 concepts.json；它是唯一能删除 catalog 的操作。收据的 `droppedConcepts` 列出相对 v1 删除的概念 ID。中断后由 `concord recover` 按前后像完成或回退，v1 成员或前像变化时返回 `RecoveryConflict`。v1 的 set-concepts journal 先用匹配的旧 CLI 恢复。

## CLI 示例

```sh
concord writing index --json
concord concepts index --json
concord concepts show --path docs/feature/payments/concepts.md --json
concord writing show --path docs/feature/payments/concord-writing.json --json

# 仅在目标缺失时使用 null；已有来源必须使用 show 返回的 digest。
concord concepts set --path docs/feature/payments/concepts.md \
  --body /tmp/reviewed-concepts.md --expected-digest null
concord writing set --path docs/feature/payments/concord-writing.json \
  --body /tmp/reviewed-policy.json --expected-digest null
concord docs check --rules docs/feature/payments/concord-writing.json --json
```

`--body -` 接受 stdin；根命令的 `--dry-run` 验证同一规划但不保存来源。删除条目通过带最新摘要的整份 catalog 更新完成，不能移除仍被引用的定义。

init 在全局政策缺失时创建随包通用预设，并保留既有政策原文。初始化和恢复只允许精确的随包预设、全局路径及空前像；自定义政策继续通过 writing.set 保存。

## 检查的文件类型

写作检查只扫描 Markdown 与 MDX，其它文件不参与文件计数、命中或输入摘要。只含其它文件的扫描根返回 WritingInputNotFound。政策 Schema 严格，未声明的字段被拒绝。


## 受控写作规则

`concord.writing/v3` 的 `controlled` 按叶子递归合成。省略和空对象保留祖先叶子，null 清除子树并保留清除来源；更深目录可重新声明。数值阈值独立开启长度检查，布尔开关默认 false；每种语言的词表与豁免数组整表替换，空数组为显式空表。有效叶子包含值、来源路径和 JSON pointer；默认值没有 owner。

```json
{
  "format": "concord.writing/v3",
  "bannedTerms": [],
  "controlled": {
    "language": "auto",
    "sentence": {"zh": {"procedural": 30, "descriptive": 40}, "en": {"procedural": 20, "descriptive": 25}},
    "paragraphSentences": 6,
    "procedural": {"singleInstruction": false, "requireVerb": false},
    "approvedWords": {"enabled": false},
    "passiveVoice": {"zh": false, "en": false}
  }
}
```

这些数值属于项目参数。Concord 不分发 ASD-STE100 原文或词典，不宣称符合该规范。词表由项目维护，词法启用要求见[采用设计](../../design/controlled-writing/plans/policy-rules/architecture.md#词表与开关)。启用程序性动作词开关时，auto 必须提供 zh/en 两张非空表；显式语言必须提供对应表。英文被动候选必须提供非空 participles，不自动推导词形。

controlled 只取 paragraph 显示文本；最近列表决定程序性或描述性，引用一律为描述性。标题、GFM 表格、图片、代码块、HTML 块和生成区域排除；行内代码为一个不透明 token。分句、缩写、Unicode token、语言比例与局部豁免按[采用设计](../../design/controlled-writing/plans/policy-rules/architecture.md)执行。legacy 字符长度与 controlled token 路径独立参与门禁。

## 从 writing/v2 迁移

普通入口遇到 v1/v2 返回 `WritingMigrationRequired`；show 保留安全读取的原文、digest 与具名诊断。`concord writing migrate --path docs/concord-writing.json --dry-run` 预览合法完整 v2 到 v3 的变更；省略 dry-run 使用完整前像和受管 publication/journal 写入，只更换 format，不添加 controlled。v1 必须先审核并迁移概念定义，不由 migrate 猜测转换。旧事务由匹配的 CLI 恢复，未知现场保留。

## 写作 JSON 结果

`concord docs check --json` 返回 `complete`、`inputDigest` 和 findings。controlled finding 包含 rule、file、原始 line/column、actual、可用时的 limit，以及 language/languagePolicy 和 source/sources。

词法命中还包含原文 text 与 start/end 范围，列和范围采用 UTF-16。source 指向开关或阈值，sources 保留实际语言、词表与豁免来源。

长度规则为 `proceduralSentenceLength`、`descriptiveSentenceLength`、`paragraphSentences`。

词法规则为 `multipleInstructions`、`unapprovedProceduralVerb`、`unapprovedWord`、`passiveVoice`。动作词只陈述词面命中，被动形式只陈述候选，不证明语义或完整语法。

`InvalidWritingPolicy` 表示非法字段或有效政策缺少所需词表。

`WritingBudgetExceeded` 表示资源上限失败且 complete 为 false。`WritingInputsChanged` 拒绝变化中的输入。失败退出 1，完整且没有 finding 时退出 0。

## 受控写作性能预算

按[统一方法](../../engineering/concord-self-hosting/performance.md)测量；参照环境、冻结消费者、规模、交错基线、cold/warm、样本有效性与资源上限见[采用设计](../../design/controlled-writing/plans/policy-rules/architecture.md#性能预算)。

| 基准命令（参数完整） | 场景 | warm p50 预算 |
| --- | --- | ---: |
| `concord docs check` | self，两条长度路径与词法规则开启 | 1000ms |
| `concord check` | self，全量聚合 | 2300ms |
| `concord docs check` | scale，1000 页、单有效表接近上限 | 5000ms |

父提交与候选产物在等价 v2/v3 消费者上交错测量 legacy，回退不得超过 20%。新规则在有效 v3 消费者上按绝对预算判定；缺少必需样本或对照不能判通过。
