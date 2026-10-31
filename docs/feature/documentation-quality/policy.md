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

Concord 识别 docs 下精确命名的 concepts.md 与 concord-writing.json，排除 docs/_template 及任何 .git、node_modules 路径段。目录决定作用域，不在来源中重复保存 scope。docs 以外的文件和其它文件名不获得这两类写入授权；聚合从来源派生，不回写全局文件。全局概念与局部概念均有来源路径，局部定义不会自动升级为全局。目录缺失、路径不安全或来源格式错误返回具名错误，不静默跳过。目录归属让局部事实留在使用它的目录，全项目视图只派生。

## 来源、合成与检查报告

维护者通过 Concord CLI 与 Web 在全局、Feature、Engineering 及其它 docs 子目录定义领域术语和写作规则。术语由 concepts.md 拥有：每个概念有稳定 ID、唯一写法、定义段落与解释，旧写法列为弃用名；写作规则由 concord-writing.json 拥有禁词和检查选项。所在目录决定局部作用域，全项目视图自动汇总并保留来源，不复制定义。

写作规则使用 concord.writing/v3；术语使用 concepts.md 的标题结构，不设版本字段。祖先规则按范围合成，局部来源不能扩大目录或静默覆盖定义。同名不同义按作用域区分；弃用名称派生禁词并建议改为该概念的写法。正文可以链接到 `concepts.md#id`，断开的链接由检查报告。

concepts.md 与 concord-writing.json 可以直接编辑；结构、作用域与被引用的定义由 `concord check` 校验，`concepts` 与 `writing` 工具是在写入前执行同一校验的助手。工具写入使用严格 Schema、整文件 CAS 与可恢复事务，show 支持无效来源显式修复。Web 草稿和异步请求绑定具体 owner，保存一份来源不能把另一份草稿标成已保存。

检查报告表达某次已保存输入快照，包括禁词、字符长度、受控 token 长度、显式启用的词法规则与术语使用。检查不自动修改正文，不声称实现合规、功能完成或测试覆盖。Concord 不内置产品专属词库、目录或 API 语义。

## 概念定义

```markdown
---
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

每个概念只有一个写法，定义与解释同在一页，正文可以链接到定义。catalog 结构如下：

1. 正文恰好一个一级标题，位于所有二级标题之前；两者之间是页面引言，可写任意 Markdown。没有二级标题的文件是合法的空 catalog。
2. 每个二级标题是一个概念，以 ` {#id}` 结尾，id 匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，在文件内唯一；完整身份为 canonical catalog path#id。
3. 去掉 id 后的标题文字是该概念唯一的写法（term）：非空、首尾无空白，只能是纯文本，不含行内代码、链接、强调或 HTML。
4. 二级标题后的第一个块必须是段落，即定义，可含链接与行内代码；结构化视图的 `definition` 是该段落的 Markdown 原文。定义之后、下一个二级标题以前是解释，可用三级及更深的标题和任意块。

frontmatter 可选，存在时位于文件开头，严格解码，只接受 imports 与 deprecated：imports 是不重复的 path#id 列表，path 必须是 catalog 路径；deprecated 的键为本文件已有的概念 ID，值为非空的弃用名列表。弃用名放在 frontmatter，写作检查不扫描它。catalog 不设版本字段。

同一文件内 term 规范化后互不重复，弃用名互不重复且不等于任何 term。ASCII 写法按忽略大小写和单词边界匹配，其它写法按字面匹配，不依赖 locale；规则检查、名称碰撞与禁词共用这一匹配。

改名时保留 ID，把旧写法加入 deprecated，检查会找出全部旧写法。需要分节的解释写在页面引言或概念下的三级标题中。

全局和祖先目录的定义自动适用于后代文件，全局概念也适用于显式的全局扫描根；imports 可显式引用其它目录的直接定义，例如 docs/feature/payments/concepts.md#payment。引用不递归导入另一文件的 imports，也不复制定义。不同兄弟目录的同名概念可以并存；有效范围相交的同名 term 报告歧义，携带双方来源，不静默覆盖。

| 错误 | 条件 |
| --- | --- |
| `InvalidConceptCatalog` | frontmatter 非法、标题或定义结构不合规、唯一性被破坏；消息带行号与原因 |
| `DanglingConceptImport` | imports 指向不存在的 catalog 或 ID |
| `AmbiguousConceptName` | 两个在同一范围生效的概念有相同的规范化 term |
| `ConceptInUse` | 写入会删除或改名仍被其它 catalog 导入的 ID；消息列出引用者 |
| `ConceptReferencesUnknown` | 另一 catalog 格式错误使反向引用无法确定时，写入删除目标中原本有效的定义 |

正文可以链接到定义，例如 `反馈`。docs 下（排除 docs/_template）Markdown 正文中相对解析后指向已发现 catalog 的行内链接是术语链接，筛选与解码规则与[品味链接](../project-onboarding/use-case/evolve-constitution.md#link-clause)相同。fragment 不是该 catalog 的概念 ID 时，`concord check` 报告 relation 类 `AnchorNotFound`，带路径与行号；不带 fragment 的链接指向整页，不产生 finding。链接文字等于 term 时照常计为使用，链接本身不计。正文链接不阻止删除定义；断开的链接由检查报告。

catalog 可以直接编辑，`concord check` 报告上表的结构、导入与歧义错误；`concepts set` 在写入前执行同一校验。位于 Feature 或 Engineering 包内的 concepts.md 是该目录的概念来源，不是该包的支持页面。

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

每份政策必须声明 `format` 与 `bannedTerms`。可选字段为 `roots`（非空路径列表）、`sentenceLength`、`paragraphLength`（正整数或 null）、`unusedConcepts`（布尔）与 `controlled`。禁词的 term、use、why 为非空文本，可选 roots、exempt 与 allowIn；同一来源重复的禁词被拒绝。

roots 可省略：全局默认为 docs，局部默认为所在目录。全局 roots 可显式选择仓库其它文档目录；局部 roots 不得越出所在目录。所有路径均为仓库相对路径，不自动按文件位置重新解释。

默认 `concord docs check --json` 选择全部政策 roots，加上没有同目录政策的概念目录；因此局部 owner 可以启动被全局窄 roots 排除的目录扫描。没有政策也可以检查概念。没有任何政策与 catalog 时返回 `WritingPolicyNotFound`；明确选中的根没有 Markdown 或 MDX 时返回 `WritingInputNotFound`。同一文件命中重叠根时只检查一次。`concord check` 的聚合门禁范围见 [聚合门禁](gate.md)。

选文件与应用规则是两个步骤。对已经选中的文件，全局和祖先政策按根目录到最近目录合成，与由哪个 owner 选中无关；roots 不取消祖先约束，单条禁词的 roots/exempt/allowIn 只限制它自身。禁词与弃用名累加，空数组不移除祖先禁词。长度和概念使用选项采用最近目录的显式值：省略表示继承，数字阈值的 null 表示清除，布尔 false 表示关闭；没有显式值时长度检查关闭，unusedConcepts 为 false。

`--rules` 指向受管政策时，仅用该政策的 roots 选文件，仍合成这些文件的祖先与后代政策。指向非受管路径时是独立只读 profile，roots 默认为 docs，仅用显式政策与有效概念，不合成其它写作政策。报告说明实际模式和选择范围。

冲突按实际适用的文件与表达位置判断，先按各自规则判断豁免，互不相交的 roots/豁免不构成冲突。相同命中可按文件、位置、规范化词与替换建议去重，但必须保留全部适用来源；冲突命中报告 `writingConflict`，不任意挑选一条替换建议。一个概念的弃用名等于另一个有效概念的 term，或禁词禁止了有效概念的 term，也报告 `writingConflict`。

## 使用统计与输入快照

概念使用按完整概念身份统计，只读取该概念实际适用（全局、祖先或直接导入）的所选正文。只有 term 算使用，弃用名称不证明正确使用；显式 import 是原概念的有效使用。catalog 文件整份不算使用，生成汇总也不算。catalog 仍参与禁词、长度与受控写作检查，解释中提到弃用名时写在行内代码中。至少一个适用文件启用检查且没有有效使用时，同一概念最多产生一条 unusedConcept 诊断，不用兄弟目录的同名概念替它证明使用。常用词作 term 时，正文的普通用法也计为使用；这只影响 unusedConcept，不产生禁词。

报告绑定政策、概念、文件集合、配置与正文的输入摘要，不含 SVG 与 CSS；读取期间变化则拒绝结果。Web 只展示某次已保存输入的历史快照，不称为当前通过。缓存的冷、暖、损坏与清空状态对同一来源给出相同的 finding、完整性与退出码。

## 工具管理与恢复

来源可以直接编辑，也可以通过 writing 与 concepts 工具及 Web 编辑；工具与 Web 使用完整 owner 摘要保护修改，直接编辑的结果由 `concord check` 校验。公开 action 为 `writing.index/show/set/check` 与 `concepts.index/show/set`，path 默认全局。show 区分 missing/valid/invalid，返回原文与 digest，安全读取的无效原文可以显式修复；危险路径和读取失败不会伪装为空态。

工具的正文输入可来自临时文件或 stdin。set 是整 owner CAS，新建时 digest 为 null，返回实际提交的来源、digest 与收据；同一 digest 的第二个写者得到 `FileChangedSinceRead`。concepts set 按提交的字节保存 Markdown，不重新序列化。

concepts set 先严格解析目标，再检查其 imports 与其它 catalog 对它的导入。各无效 catalog 可逐项修复，修复后已知的有效导入者必须仍能解析；无关的格式错误或悬空 catalog 不阻止增量修复，但 check 与 index 不把它们报告为正常。设置 catalog 不需要解析写作政策。

publication 与 recovery 双向校验精确路径、具名操作、唯一有效 after 和配置绑定；错误操作、任意 JSON 或 Markdown、删除、额外文件、symlink、配置漂移与未知编辑在写入前被拒绝。concepts 写入还保存其它 catalog 的完整集合与原文摘要（操作名 `set-concepts`）；事务中断后新增、删除或修改 importer 会以 `RecoveryConflict` 拒绝恢复并保留现场。prepared 恢复精确 before（包括原来的无效 bytes），committed 保留已提交内容，不要求 before 已经符合当前 Schema。

init 只在缺失时把 docs/concepts.md 创建为随包空 catalog，并绑定真实的新配置初始化；保留已有 docs/concepts.md 的全部字节，即使它不是合法 catalog，之后的检查报告 `InvalidConceptCatalog`。这个例外不允许局部 catalog、非空定义或任意 Markdown 混入 init。

```markdown
# Project concepts

Each second-level heading defines one concept: its text is the only accepted spelling, `{#id}` is its stable identity, and the first paragraph is its definition.
```

## 无效输入

写作政策只接受 `concord.writing/v3`，术语只由 concepts.md 拥有（[当前格式](../../architecture.md#当前格式)）。其它格式的政策是无效输入，返回 `InvalidWritingPolicy` 并保留原文；其它文件不被读取或检测。

## CLI 示例

```sh
concord writing index --json
concord concepts index --json
concord concepts show --path docs/feature/payments/concepts.md --json
concord writing show --path docs/feature/payments/concord-writing.json --json

# 仅在目标缺失时使用 null；已有来源必须使用 show 返回的 digest。
concord concepts set --path docs/feature/payments/concepts.md \
  --body /tmp/reviewed-concepts.md --if-unchanged null
concord writing set --path docs/feature/payments/concord-writing.json \
  --body /tmp/reviewed-policy.json --if-unchanged null
concord docs check --rules docs/feature/payments/concord-writing.json --json
```

`--body -` 接受 stdin；根命令的 `--dry-run` 验证同一规划但不保存来源。经工具删除条目通过带最新摘要的整份 catalog 更新完成，不能移除仍被其它 catalog 导入的定义；直接编辑删除这类定义时，`check` 报告 `DanglingConceptImport`。

`concepts index` 返回全部 catalog、概念与诊断，每个概念为 `{ reference, path, scope, concept: { id, term, definition, deprecated } }`，没有弃用名时 `deprecated` 为空数组。`concepts show` 返回 `state`、`source`、`digest`、解析后的 `catalog`（`title`、`imports`、`deprecated`、`concepts`），以及当前目录的有效概念与诊断。结构化 action `concepts.set` 的输入为 `{ path, source, ifUnchanged }`。

init 在全局政策缺失时创建随包通用预设，并保留既有政策原文。初始化和恢复只允许精确的随包预设、全局路径及空前像；自定义政策直接编辑或通过 writing.set 保存。

## 检查的文件类型

写作检查只扫描 Markdown 与 MDX，其它文件不参与文件计数、命中或输入摘要。只含其它文件的扫描根返回 WritingInputNotFound。政策 Schema 严格，未声明的字段被拒绝。

legacy 长度路径取 paragraph 文本：包含行内代码内容、链接显示文本，排除图片替代文字和链接目标；空白不计，其余每个 code point 计 1。分句在 `。！？!?` 之后，或在 `.!?` 加空白之后、下一个字符为行内代码、大写字母、数字、引号、左括号或汉字时；不套用 controlled 的缩写规则。

## 受控写作规则

`concord.writing/v3` 的 `controlled` 按叶子递归合成。省略和空对象保留祖先叶子，null 清除子树并保留清除来源；更深目录可重新声明，不重新取得清除前的祖先值。数值阈值独立开启长度检查，布尔开关默认 false；每种语言的词表、forms 与豁免数组整表替换，空数组为显式空表。有效叶子包含值、来源路径和 JSON pointer；默认值没有 owner。字符长度与受控 token 长度两条路径可同时生效，两类阈值互不约束。规则内置于政策，门禁只读当前来源快照，不运行外部命令、网络或模型。

```json
{
  "format": "concord.writing/v3",
  "bannedTerms": [],
  "controlled": {
    "language": "auto",
    "sentence": {"zh": {"procedural": 30, "descriptive": 40}, "en": {"procedural": 20, "descriptive": 25}},
    "paragraphSentences": 6,
    "procedural": {"singleInstruction": false, "requireVerb": false, "verbs": {"zh": ["删除"], "en": [{"lemma": "write", "forms": ["writes", "wrote"]}]}, "allowIn": {"zh": []}},
    "approvedWords": {"enabled": false, "en": [], "allowIn": {"en": []}},
    "passiveVoice": {"zh": false, "en": false, "participles": [], "allowIn": {"zh": ["被动"]}}
  }
}
```

例如根声明 en 程序性 20、描述性 25 与 en 动词 read，子目录仅声明 en 程序性 null 与 zh 动词读取：子目录 en 程序性关闭、描述性 25，en 动词 read、zh 动词读取。再下层 `verbs.en: []` 只清空 en 动词；`procedural: null` 清除该子树的开关、词表与豁免。`verbs.en` 以整表替换，forms 省略表示该条只有 lemma，不从祖先同名词补取。

这些数值属于项目参数，中文阈值需用项目语料校准。Concord 不分发 ASD-STE100 原文或词典，不宣称符合该规范；词表由项目维护。

### 抽取与计数

controlled 每个 paragraph 形成一个文本块；多段 listItem 的每段单独计句，嵌套列表不并入父段。最近 listItem 所属列表为有序时是程序性文本，普通段落与无序项为描述性；引用内一律为描述性，包括引用内的列表。标题、GFM 表格、图片、代码块、HTML 块、frontmatter、生成区域，以及 MDX 的 import/export、JSX 标签行与表达式均排除。链接与强调只取显示文本；软换行与硬换行视为空格。行内代码是一个不透明 token，计 1，不参与分句、词表与语言比例。合法步骤标记（见[步骤语法](../local-sdlc/use-case/link-tests-to-steps.md)）的末尾 `{#id}` 在两条路径中均排除；代码中的相同文字不是步骤标记。

分句：`。！？!?` 的连续序列是一个句末；英文句点在块末或后接空白、引号或右括号时结束句子，数字间小数点、`U.S.` 这类连续首字母缩写，以及忽略大小写的 `e.g.`、`i.e.`、`Mr.`、`Mrs.`、`Ms.`、`Dr.`、`Prof.`、`vs.`、`etc.` 除外。紧随句末的引号与右括号归入前句；分号、冒号与 `…` 不另起句，连续句点整体为一个句末，块尾非空残余也是一句。只含空白或标点的片段不形成句子，只含代码或数字的片段形成一句。

token 从左到右最长匹配：每个汉字一个；拉丁字母连同结合标记成词，两侧均为拉丁字母的 `'`、`’` 与 `-` 留在词内；连续数字及其间小数点成一个；其它连续非汉字、非拉丁字母成一个词；标点只作分隔。`3.14`、`don't`、`state-of-the-art`、`café` 各计 1，`U.S.` 与 `v3` 各计 2。

`language` 为 auto 时，分母是去除代码与标记后的 Unicode 字母数，分子为其中的汉字数；比例不小于 1/2 选 zh，否则选 en，分母为 0 选 en。语言只决定阈值与词表，不改变 token 计数。显式 zh 或 en 作用于目录内每句；auto 是可复现的启发式，不声称识别正确。

### 词表与词法规则

匹配输入作 NFC 规范化，英文按 Unicode 默认规则小写折叠，`’` 归一为 `'`，范围映射回原文。中文词表项是连续汉字串；en lemma、forms、批准词与 participles 各是一个拉丁 token，不允许空项，不自动派生 -s/-ed/-ing。同表规范化后重名，或不同 lemma 有相同 form，政策被拒绝。中文按字面、英文按完整 token 匹配；先排除本规则 allowIn 覆盖的范围（重叠取并集），再从左取最长匹配，已选范围不重叠，短语不跨代码、句界或段落。同一词面重复出现按次数计。

| 开关 | 检查 | rule 与文案 |
| --- | --- | --- |
| `procedural.singleInstruction` | 程序性句命中动作词超过 1 次 | `multipleInstructions`，“命中多个受控动作词” |
| `procedural.requireVerb` | 程序性句未命中动作词 | `unapprovedProceduralVerb`，“未命中项目受控动作词” |
| `approvedWords.enabled` | 选为 en 的句子中未列入 `approvedWords.en` 的拉丁 token；大小写不豁免，空表禁止全部拉丁词 | `unapprovedWord` |
| `passiveVoice.zh` | 未豁免的字符“被” | `passiveVoice`，“命中被动形式候选” |
| `passiveVoice.en` | `am/is/are/was/were/be/been/being` 紧接 participles 中的词形 | `passiveVoice`，“命中被动形式候选” |

启用前两个开关时，每个可能选中的语言都须有非空 verbs 表（auto 要求 zh 与 en）；启用 `passiveVoice.en` 须有非空 participles。空表或 null 不隐式关闭开关，有效政策返回 `InvalidWritingPolicy` 并列出开关与词表来源。数字、代码与非拉丁 token 不参与批准词检查，概念 term 不自动加入批准词表。词法 finding 只陈述词面观察，不证明指令数量、词性或语态。随包预设不开启词法开关。

项目开启词法门禁前，用含真实中英文程序性、描述性与混排段落的人工标注语料记录样本规模、各规则 TP/FP/FN、局部豁免与可接受阈值；结果归 Memory。

## 写作 JSON 结果

`concord docs check --json` 返回 `complete`、`inputDigest` 和 findings。controlled finding 包含 rule、file、原始 line/column、actual、可用时的 limit，以及 language/languagePolicy 和 source/sources。

词法命中还包含原文 text 与 start/end 范围，列和范围采用 UTF-16。source 指向开关或阈值，sources 保留实际语言、词表与豁免来源。

长度规则为 `sentenceLength`、`paragraphLength`（字符）与 `proceduralSentenceLength`、`descriptiveSentenceLength`、`paragraphSentences`（token 与句数）。

| 错误 | 条件 |
| --- | --- |
| `InvalidWritingPolicy` | 非当前格式、未知字段、非法阈值、词表重复或同形冲突、无效路径，或有效政策缺少所需词表；列出来源 |
| `WritingBudgetExceeded` | 单个词表数组超过 4096 个形式，合成后单语言词表与豁免超过 16384 个形式或 1 MiB，短语超过 128 code point，单段候选区间超过 100000，或 finding 超过 10000；complete 为 false |
| `WritingInputsChanged` | 读取期间字节、政策或成员集合变化 |

失败退出 1，完整且没有 finding 时退出 0；截断结果不宣称完整。

## 性能预算

按[统一方法](../../engineering/concord-self-hosting/performance.md)测量：参照环境为 AMD Ryzen 7 5800X、Linux x64、Node v24.19.0。参照消费者为本仓库 commit `36250cef0394d04eee75d88315bb133bae72d773` 的独立 clone，经公开 CLI 加入 v3 政策后提交冻结，记录派生 commit、产物摘要与实际文档及 token 数。self 开启 zh/en 长度与词法规则；scale 含 1000 个支持页，每页 10 KiB prose 与 1000 个 token，10% 混排，每段 2 个代码 token。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `documentation-quality/docs-check` | self 冻结副本，两条长度路径与词法规则开启 | 1000ms |
| `documentation-quality/check` | 同一 self 冻结副本的全量聚合 | 2300ms |
| `documentation-quality/check-server` | 同一冻结副本经由运行中的工作区服务的全量聚合 | 2300ms |
| `documentation-quality/docs-check-scale` | 1000 页、每页约 10KiB 与 1000 token、4096 项词表 | 5000ms |
| `documentation-quality/writing-index` | 目录政策索引 | 610ms |
| `documentation-quality/concepts-index` | 目录术语索引 | 650ms |

场景准备由 `bench/documentation-quality.bench.ts` 与 `bench/fixtures/` 拥有。

父提交与候选产物在同一 v3 消费者上交错测量 legacy 长度规则，回退不得超过 20%。controlled 规则按绝对预算判定；缺少必需样本或对照不能判通过。极端重叠词表须以 `WritingBudgetExceeded` 失败而非耗尽资源。
