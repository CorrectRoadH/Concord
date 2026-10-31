# 术语与写作规则的文件格式

术语写在 `concepts.md`，写作规则写在 `writing.md`。两种文件都是普通 Markdown，直接编辑；放在哪个目录，就对那个目录及其子目录生效。

## concepts.md

```markdown
# 购物车术语

本页定义购物车里的名词。

## 订单 {#order}

顾客提交的一次购买，包含商品、数量和收货地址。

旧写法：`单子`、`订货单`

下单后订单不能再改商品，只能取消后重下。
```

- 一级标题之后、第一个二级标题之前是引言。
- 每个二级标题是一个概念：去掉 `{#id}` 后的标题文字是它唯一的写法，`{#id}` 是稳定身份，在文件内唯一，只用小写字母、数字和单连字符。
- 标题下第一段是定义。
- 定义后以“旧写法：”开头的一段列出弃用的写法，每个写在行内代码里，用顿号或逗号分隔。正文里出现旧写法时，检查报告它并建议改成概念的写法。
- 其余段落是解释，可以用三级标题分节。
- 正文可以链接到定义，例如 `[订单](../cart/concepts.md#order)`；fragment 不存在时，`concord check` 报告 `AnchorNotFound`。

改名时保留 ID，把旧写法加进“旧写法”，检查会找出所有还在用旧写法的地方。

## writing.md

```markdown
# 写作规则

句子不超过 140 个字符，段落不超过 320 个字符。

## 不用的词

| 词 | 改成 | 为什么 | 只在 | 例外 |
| --- | --- | --- | --- | --- |
| helper | 写具体职责：解析器、构造器或清理函数 | 没有说明这段代码做什么 | | |
| 目前 | 直接写目标行为 | Spec 只写现在 | docs/feature、docs/roadmap | 到目前为止 |

## 检查范围

- docs
- README.md
```

- 第一段可以写句长和段长上限，形如“句子不超过 N 个字符，段落不超过 N 个字符”。不写时继承上级目录的上限；整个链上都没有声明时不检查长度。
- “不用的词”是一张五列表：词、改成什么、为什么、只在哪些目录生效、例外。“只在”留空表示整个检查范围；“例外”列出包含这个词但可以用的更长写法，例如禁“目前”但允许“到目前为止”。
- “检查范围”只在 `docs/writing.md` 里出现，列出要检查的目录和文件；省略时只检查 `docs`。

## 生效范围

- `docs/` 下的 `concepts.md` 与 `writing.md` 对所在目录及其子目录生效。长度上限取最近一份声明了长度的 `writing.md`，局部文件没写长度时沿用上级；不用的词与上级合在一起。
- `writing.md` 是规则输入：只校验它的格式，不参与正文的写作检查，也不计入概念使用。`concepts.md` 中的旧写法写在行内代码里，同样不会被当成违规。
- 全局 `docs/concepts.md` 的概念对整个检查范围生效，包括根目录的 README。
- 两个兄弟目录可以用同一个词表示不同的概念；同一个范围里出现两个同名概念时，检查报告 `AmbiguousConceptName`。
- 其它文件名不定义术语或规则。

## 匹配

- 英文按整词、忽略大小写匹配；中文按字面匹配。
- 代码块、行内代码、链接地址和 HTML 注释不参与检查；链接文字参与。
- 长度忽略空白，标题和表格不计长度。
- 每个概念至少要在它生效的范围里被用到一次，否则检查报告 `unusedConcept`；`concepts.md` 本身不算使用。

## 检查结果

```sh
concord docs check
```

只检查写作与术语；`concord check` 把它和关系检查合在一起，见[合并检查](gate.md)。finding 带文件、行号、规则与建议写法：

```text
docs/feature/cart/README.md:27 [bannedTerm] 单子: use 订单; docs/concepts.md#order
```

| finding | 什么时候出现 |
| --- | --- |
| `bannedTerm` | 正文用了“不用的词”或概念的旧写法 |
| `sentenceLength`、`paragraphLength` | 句子或段落超过上限 |
| `unusedConcept` | 概念在生效范围里没有被用到 |
| `AmbiguousConceptName` | 同一范围里有两个同名概念 |
| `InvalidConceptCatalog`、`InvalidWritingPolicy` | 文件结构不符合本页的格式，消息带行号与原因 |

检查只报告，不改正文。

## 性能预算

按[统一方法](../../engineering/concord-self-hosting/performance.md)测量，参照环境为 AMD Ryzen 7 5800X、Linux x64、Node v24.19.0，参照消费者是本仓库的冻结副本。scale 含 1000 个支持页，每页约 10 KiB 正文。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `documentation-quality/docs-check` | 本仓库冻结副本的写作与术语检查 | 1000ms |
| `documentation-quality/check` | 同一冻结副本的合并检查 | 2300ms |
| `documentation-quality/check-server` | 同一冻结副本经由运行中的工作区服务的合并检查 | 2300ms |
| `documentation-quality/docs-check-scale` | 1000 页、每页约 10 KiB | 5000ms |
| `documentation-quality/concepts-index` | 列出全部术语 | 650ms |

场景准备由 `bench/documentation-quality.bench.ts` 与 `bench/fixtures/` 拥有。
