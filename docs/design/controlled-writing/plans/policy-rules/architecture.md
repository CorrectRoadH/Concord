# 政策规则

## Entity Ownership

唯一政策 owner 为目录中的 `concord-writing.json`；领域术语仍由 `concepts.json` 拥有。下列类型穷尽 v3 字段，所有对象严格拒绝未知字段，JSON 不接受 undefined。问号表示可省略，`Clear<T>` 表示 T 或 null。

```ts
type Clear<T> = T | null;
type PositiveInt = number; // 安全整数且 > 0
type Text = string; // 非空且含非空白字符
type Paths = readonly Text[]; // canonical 仓库相对路径，沿用安全校验
type Lexeme = string; // 下文的单个规范化 token
type Phrase = string; // 下文的非空规范化字面短语
type Ban = {
  term: Text; use: Text; why: Text;
  roots?: Paths; exempt?: Paths; allowIn?: readonly Text[];
};
type LanguageTables<T> = { zh?: Clear<T>; en?: Clear<T> };
type Exceptions = { allowIn?: Clear<LanguageTables<readonly Phrase[]>> };
type Verb = { lemma: Lexeme; forms?: readonly Lexeme[] };
type VerbTables = {
  zh?: Clear<readonly Lexeme[]>;
  en?: Clear<readonly Verb[]>;
};
type SentenceLimits = {
  zh?: Clear<{ procedural?: Clear<PositiveInt>; descriptive?: Clear<PositiveInt> }>;
  en?: Clear<{ procedural?: Clear<PositiveInt>; descriptive?: Clear<PositiveInt> }>;
};
type Controlled = {
  language?: Clear<'auto' | 'zh' | 'en'>;
  sentence?: Clear<SentenceLimits>;
  paragraphSentences?: Clear<PositiveInt>;
  procedural?: Clear<{
    singleInstruction?: Clear<boolean>;
    requireVerb?: Clear<boolean>;
    verbs?: Clear<VerbTables>;
    allowIn?: Clear<LanguageTables<readonly Phrase[]>>;
  }>;
  approvedWords?: Clear<Exceptions & {
    enabled?: Clear<boolean>;
    en?: Clear<readonly Lexeme[]>;
  }>;
  passiveVoice?: Clear<Exceptions & {
    zh?: Clear<boolean>;
    en?: Clear<boolean>;
    participles?: Clear<readonly Lexeme[]>;
  }>;
};
type WritingPolicyV3 = {
  format: 'concord.writing/v3';
  roots?: readonly [Text, ...Text[]];
  bannedTerms: readonly Ban[];
  sentenceLength?: Clear<PositiveInt>;
  paragraphLength?: Clear<PositiveInt>;
  unusedConcepts?: boolean;
  controlled?: Clear<Controlled>;
};
```

`roots`、Ban 的路径与作用域、累加禁词及概念规则沿用[政策契约](../../../../feature/documentation-quality/policy.md)。两种长度路径可同时生效，没有“开启 controlled 自动关闭 legacy”的行为。两类阈值独立，不要求描述性数值大于程序性。

## 目录合成表

先按政策 roots 选择文件，再收集适用的祖先政策，按根目录到最近目录合成。roots 不清除祖先规则；standalone profile 只有自身一个 owner，不继承受管政策。

| 字段或输入 | 合成行为 | 没有显式值时 |
| --- | --- | --- |
| `format`、`bannedTerms` | 每份政策都必须声明；格式须一致为 v3 | 拒绝缺失 |
| `roots` | 每个 owner 独立决定选取范围，不作叶子继承 | 沿用所在目录默认范围 |
| `bannedTerms`、概念弃用名 | 沿用 legacy 累加；空数组不移除祖先禁词 | 不新增禁词 |
| legacy 长度与 `unusedConcepts` | 最近显式标量；长度 null 关闭，布尔 false 关闭 | 长度关闭，unusedConcepts 为 false |
| controlled 的非数组对象 | 按叶子递归合成；空对象不覆盖祖先叶子 | 保留祖先结果 |
| controlled 的任意对象 null | 清除该子树全部继承叶子，记录清除来源；更深目录可重新声明 | 该子树使用惰性默认值 |
| controlled 的数值或 language 叶子 | 最近显式值；null 清除继承 | 长度关闭，language 为 auto |
| controlled 的布尔叶子 | 最近显式值；false 关闭，null 清除继承 | false |
| controlled 的词表、forms、allowIn 数组 | 最近显式整表替换，不追加；null 清除，空数组为显式空表 | 空表 |

词表替换单位是每个语言叶子。`verbs.en` 整表替换包含其中的 lemma 与 forms；不能只覆写某个词。`forms` 省略表示该条只有 lemma，不从祖先同名词补取 forms。

每个有效叶子保留来源路径、JSON pointer 与值；null 保留“清除”来源，默认值注明无 owner。finding 的 source 指向触发开关或阈值，sources 同时列出实际用到的词表、语言与豁免来源。

示例：根声明 en 程序性 20、描述性 25 与 en 动词 read；子目录仅声明 en 程序性 null、zh 动词读取。结果为 en 程序性关闭、描述性 25，en 动词 read、zh 动词读取。再下层 `verbs.en: []` 清空 en 动词而保留 zh；`procedural: null` 则清除该子树的开关、词表与豁免。

## legacy 字符路径

legacy 沿用 `writing.ts` 的 authoredSource 与 prose 抽取：paragraph 和 heading 参与禁词；只有 paragraph 参与长度，标题不作长度检查。表格处理及 MDX 排除保持同一规则，不能用 controlled 的 AST 类型替代此路径。

长度文本包含行内代码的内容字符、链接显示文本，排除图片 alt 和链接目标；空白不计数，其余每个 Unicode code point 计 1。分句仍按 `。！？!?` 之后或英文句点加空白加大写字母之前切分；不得套用 controlled 的缩写规则。

唯一共享归一化是排除[步骤语法](../../../test-journey-steps/共同身份.md#步骤语法)识别的末尾标记与前导分隔空格。代码与示例中的相同字符不是步骤标记。无步骤标记、无 controlled 的迁移语料须逐项保持 legacy finding 等价；含步骤标记的语料须验证仅排除标记带来的长度与词表差异。

## controlled 文本抽取

每个 paragraph 只形成一个文本块。按最近 listItem 所属 list 的 ordered 属性分类；多段 listItem 的每段单独计句数。嵌套列表不并入父段，引用中的 paragraph 一律为描述性；引用内列表也按描述性处理。

标题、GFM 表格、代码块、HTML 块、frontmatter、GENERATED 区域均排除。MDX 使用相同 authoredSource 预处理，排除 import/export、JSX 标签行及表达式；残余 Markdown paragraph 参与检查，不读取属性或执行表达式。

行内强调与链接只保留显示文本；链接目标、图片及其 alt、HTML 标签和 MDX 表达式均排除。软换行视为空格，硬换行也是空格，不另起句。行内代码形成不透明 token，保持其位置，每个计 1，内容既不分句也不参与词表与语言比例计算。

两条路径共享步骤标记识别，不为写作另建 anchor parser。验收条目没有步骤身份；无标记的有序列表仍可被 controlled 分类为程序性文本，两种分类用途独立。

## controlled 分句与 token

扫描显示文本的 code point，先保护行内代码与数字小数点，再切句。`。！？!?` 的连续序列形成一个句末；英文句点在块末或后接空白时结束句子，除下列固定例外：数字间小数点、连续首字母缩写如 `U.S.`，以及忽略大小写的 `e.g.`、`i.e.`、`Mr.`、`Mrs.`、`Ms.`、`Dr.`、`Prof.`、`vs.`、`etc.`。缩写集合绑定解析器版本，不由运行环境决定。

双引号、单引号、右括号紧随句末符时归入前句。分号、冒号与省略号 `…` 不另起句；ASCII 连续句点整体作为一个句末。块尾的非空残余也是一句。只有空白、标点或被排除节点的片段不形成句子；只有代码或数字的片段形成一句。

词法单元从左到右采用最长匹配：每个 Han script code point 为一个汉字单元；Unicode Latin script 字母与其结合标记组成拉丁词；内部撇号 `'` 或 `’`、连字符 `-` 仅在两侧均为拉丁字母时保留为同一词。连续十进制数字及其数字间的小数点形成一个数字 token。其它连续非 Han 的 Unicode 字母及结合标记形成一个词；其它标点仅作分隔。

因此 `don't`、`state-of-the-art` 各计 1，`3.14` 计 1，`U.S.` 计 2。字母与数字相邻时分开，`v3` 计 2。Han、非 Latin 字母和数字在 en 策略下也各按上述单元计数，不静默忽略不熟悉的文字。空句计 0，行内代码恒为 1。

`language=auto` 时，分母为代码及标记剔除后的 Unicode Letter code point 数；分子为其中 Han script Letter 数，结合标记与数字不进入分母。比例大于等于 1/2 选 zh，其余选 en；分母为 0 时选 en。zh 与 en 均使用上述 token 序列，差别是选取的阈值和词表，不改变代码的权重。

显式 `language=zh|en` 对目录内每句生效。技术词多的中文可能由 auto 选 en；这只是阈值策略。不存在隐式第三套 mixed 规则；混排验收应记录 auto 与显式设置的差异。

## 词表与开关

数值阈值本身开启长度规则。`singleInstruction`、`requireVerb`、`approvedWords.enabled`、`passiveVoice.zh/en` 相互独立，默认 false。预设也不默认开启词法启发式；迁移不创建 controlled。

匹配输入作 NFC 规范化，英文词与短语按 Unicode 默认小写折叠，不受 locale 影响，`’` 归一为 `'`；保留到原始文本的范围映射。中文词表项是连续 Han 字符串；en lemma、forms、批准词及 participles 必须各是一个规范化拉丁 token，不允许空项或自动派生后缀。

lemma 和 forms 中显式列出 `write/writes/writing/wrote/written` 或 `remove/removes/removing/removed`。规范化后同表重名、不同 lemma 的同形形式均拒绝。未列出的词形不自动匹配。相同词面重复出现在句中按出现次数计，例如 `read the read result` 命中两次。

中文按字面匹配；英文按完整 token 匹配。先排除本规则 `allowIn` 覆盖的字面短语范围，再从最左位置选择最长匹配，已选范围不重叠。短语不得跨代码、句界或 paragraph；重叠豁免范围取并集。不同规则独立应用各自豁免。

`singleInstruction=true` 时，程序性句命中大于 1 次报告 `multipleInstructions`，文案为“命中多个受控动作词”，附词面、范围与次数。`requireVerb=true` 且零次命中报告 `unapprovedProceduralVerb`，文案为“未命中项目受控动作词”。它们不检查描述性句。

启用上述任一开关时，对每个可能选中的语言都必须有非空 verbs 表。auto 要求 zh/en 两表；显式语言只要求对应表。空表或 null 不隐式关闭开关，而使有效政策返回 `InvalidWritingPolicy`，附开关与词表来源。

`approvedWords.enabled=true` 仅检查选为 en 的句子中的拉丁 token；数字、代码与非 Latin token 不匹配词表。`en: []` 是有效空白名单，所有未豁免拉丁词产生 `unapprovedWord`。大小写不豁免，句首 `Execute` 与 `execute` 同样检查；概念 preferred/aliases 不自动加入批准词表。

`passiveVoice.zh=true` 报告未豁免的字符“被”，例如 `allowIn.zh=["被动"]` 可排除“被动模式”。`passiveVoice.en=true` 匹配相邻 token：`am/is/are/was/were/be/been/being` 加 participles 中显式词形。启用 en 而 participles 为空时拒绝有效政策；不通过自动 `-ed` 或隐含不规则词表推导。

语态 finding 文案为“命中被动形式候选”，列出匹配文本；不声称识别完整语态。`is ready` 不匹配未列出的 ready，`is quickly cleared` 可漏报。这些限制与中文动作词的名词用法都进入语料验收。

## Data Flow

1. 取得当前配置、政策、术语与选中文档的同一来源快照，严格解码 v3。
2. 合成有效政策并验证跨叶约束。抽取共享步骤标记，再分别建立 legacy 与 controlled 视图。
3. 逐块分句、计数及匹配，finding 保留原始位置、实际计数、阈值与政策来源；语言策略也进入说明。
4. 复核所有输入字节和成员集合；变化具名失败，不发布陈旧的成功。

缓存只加速当前解析，不保存新规则 owner。报告摘要包含配置、全部政策原文、术语、文档成员与字节、Markdown 及词法实现版本。cold、warm、损坏及清空后的同源结果必须相同。

## Errors

| 阶段 | code 或 rule | 结果 |
| --- | --- | --- |
| 格式 | `WritingMigrationRequired` | 普通入口遇到非当前格式，保留原文与事务现场 |
| 解码与合成 | `InvalidWritingPolicy` | 未知字段、非法阈值、词表重复、无效路径或开关缺词表；列出来源 |
| 资源 | `WritingBudgetExceeded` | 超出词表、匹配或 finding 上限，complete 为 false，非零退出，不截断后声称完整 |
| 当前来源 | `WritingInputsChanged` | 字节、政策或成员集合变化，拒绝当前成功 |
| 长度 | `sentenceLength`、`paragraphLength` | legacy 字符长度 finding |
| 长度 | `proceduralSentenceLength`、`descriptiveSentenceLength`、`paragraphSentences` | controlled token 或句数 finding |
| 词法 | `multipleInstructions`、`unapprovedProceduralVerb`、`unapprovedWord`、`passiveVoice` | 仅陈述词面观察，进入写作门禁 |

## Identity and Reuse

比较两种兼容策略：v2 增加可选 controlled，旧 CLI 也会因严格 Schema 拒绝未知字段；v3 则使没有 controlled 的 owner 也需要迁移。选择 v3 作为本候选的模型边界，因为它清楚标识新的抽取、合成与资源约束，代价是显式迁移范围更大。这是候选内的格式选择，不代表 Design 已定案。

普通入口只接受 v3。显式 `writing migrate` 只接受完整、合法的 v2 输入，保留其它字段并更换 format，不添加 controlled；v1 返回其专用迁移诊断，不能猜测转换。迁移显示变更预览，使用 show 返回的 digest、完整前像和受管 publication/journal 协议写入，冲突拒绝覆盖。

旧 journal 先使用匹配 CLI 恢复到一致前像，再离线保留原件、迁移 owner 与升级运行时；未知锁与现场保持阻断。v3 的 CAS 不授权读取任意旧 journal。回退运行时必须同时恢复匹配格式与现场，不补写或重算旧收据。

## 受影响入口

| 入口或产物 | 格式与行为契约 |
| --- | --- |
| init 预设、随包模板与 skill 示例 | 统一生成 v3；新开关 false，示例词表属于项目参数 |
| writing show/set、结构化 actions | show 返回原文及摘要；set 严格 v3 和完整 CAS；standalone 同样解码 |
| writing migrate、dry-run | 显式 v2 到 v3，冲突、前像、变更集与无写入预览一致 |
| docs check、concord check、doctor 中的写作检查 | 共享当前快照、同一合成和具名错误，不运行外部建议 |
| Web 政策读取、编辑及检查 | 与 CLI 共用领域操作、摘要与 Schema，不接受任意 JSON 绕过 |
| journal/publication/recovery | 当前格式严格解码；旧事务由匹配 CLI 恢复，保留未知现场 |
| documentation-quality Feature/policy、CLI JSON、使用指引 | 同步声明 v3、合成、计数、迁移及诊断；不得只更新解析器 |
| 缓存与随包公开 CLI 测试 | 绑定解析器版本，冷暖同源一致；隔离消费者覆盖实际入口 |

## 性能预算

本候选给出实施验收的预算，测量结果归 Memory。预算采用[统一方法](../../../../engineering/concord-self-hosting/performance.md)：构建产物启动到退出，输出落盘；先预热，再至少 7 个新进程，基线与候选交错取 warm p50。cold 为 cache clear 后首次运行，单独记录。

参照环境为 AMD Ryzen 7 5800X、Linux x64、Node v24.19.0。参照消费者为本仓库 HEAD `36250cef0394d04eee75d88315bb133bae72d773` 的独立 clone，另以公开 CLI 加入 v3 政策后提交冻结；记录派生 commit、产物摘要及实际文档/token 数，不能把未提交工作区充当消费者。

self 启用 zh/en 长度，另建显式启用词法规则的同规模消费者。scale 包含 1000 个支持页、每页 10 KiB prose 与 1000 个 token，含 10% 混排及每段 2 个代码 token；使用提交冻结后的实际字节和 token 数记录规模。

| 基准命令（参数完整） | 场景 | warm p50 预算 |
| --- | --- | ---: |
| `concord docs check` | self，两条路径与词法规则均开启 | 1000ms |
| `concord check` | self，全量聚合 | 2300ms |
| `concord docs check` | scale，1000 页、单有效表接近上限 | 5000ms |

父提交构建产物为基线。未支持 v3 的基线在等价 v2 消费者上运行 legacy；新旧产物的 legacy 路径交错对照不得回退超过 20%。新规则路径与有效 v3 消费者按候选绝对预算判定；不能把基线拒绝 v3 的耗时当有效对照。

词表每个有效数组最多 4096 个规范化表面形式（含 forms），合成后每种语言所有表和豁免总计最多 16384 个形式、1 MiB UTF-8。每个短语最多 128 code point；每个 paragraph 最多检查 100000 个候选区间，每次命令报告最多 10000 个 finding。超限具名失败，不静默漏检。

编译匹配器按有效政策摘要复用；成本目标为 O(输入字节 + 词表字节 + 实际候选区间)。多模式匹配仍有输出成本，极端重叠词表须验证预算失败而非耗尽资源。空白名单与大量重复词的 finding 同样受上限控制。

最大值超过 p50 两倍时样本组无效，连续两组无效视为失败；缺少参照信息、7 次样本或必需对照不能判通过。测量不能跳过摘要、Schema、成员或完整性校验。现有 bench 路径不自动读取 Design；采用时把预算落入 documentation-quality owner，再接入相同测量路径。
