# 检查命令

本页声明 `concord check` 与 `concord docs check` 的结果、finding 与退出码。`concepts.md` 与 `writing.md` 的写法见[文件格式](format.md)。

## 合并检查

`concord check` 一次运行关系检查和写作检查：Spec、测试标记、代码声明与链接是否对得上，页面是否属于合法的页面种类，正文有没有用错的词、超长的句子或没被用到的概念。其中的写作检查与 `concord docs check` 使用同一份 `writing.md` 与 `concepts.md`。命令的人读输出与 JSON 示例见[检查关系](../local-sdlc/cli.md#检查关系)。

- 结果：JSON 的 `ok` 在没有任何 finding、且全部输入都读到时为 true。`complete` 为 false 表示有文件没能读取，结论不完整。每条 finding 带 `category`（`relation` 或 `writing`）与具名 code；`checks.relations` 与 `checks.writing` 分别给出 `ok` 与 `complete`。
- 退出码：`ok` 为 true 时退出 0，否则退出 1。
- 没有任何 `writing.md` 时，写作检查只检查概念，不检查长度与不用的词。
- CLI、结构化 action、Web 与 Concord mod 看到的是同一份结果。
- 检查失败不妨碍读取、直接编辑或运行其它命令。

## 页面种类

Feature、Engineering 与 Roadmap 文档包内的每个 Markdown 页面必须属于[页面种类](../../document-model.md#页面种类)中的一种。按[路径与识别](../../document-model.md#路径与识别)仍无法归类的页面产生 `UnknownPageKind`：

- `category` 为 `relation`，`path` 为该页面，`checks.relations.ok` 与总的 `ok` 为 false，退出 1。
- `complete` 不受影响：页面已经读到，结论完整。
- 页面照常被发现、在 `show` 的 `pages` 中以 `unknown` 列出，可以阅读与编辑。
- 文件名与某个种类拼写接近时，`details.suggestions` 给出该种类；否则列出全部种类。

| 路径 | 结果 |
| --- | --- |
| `docs/feature/cart/cli.md` | cli 页 |
| `docs/feature/cart/architecture/README.md` | architecture 种类目录的入口 |
| `docs/feature/cart/architecture/checkout-flow.md` | architecture 页，种类取自目录 |
| `docs/feature/cart/use-case/README.md` | Use Case 导航页，不是旅程 |
| `docs/engineering/testing/performance.md` | performance 页 |
| `docs/feature/cart/concepts.md` | 术语表，按[文件格式](format.md#conceptsmd)检查 |
| `docs/guides/release.md` | 文档包外的普通文档，不检查种类 |
| `docs/feature/cart/scope.md` | `UnknownPageKind`，列出全部种类 |
| `docs/feature/cart/archtecture.md` | `UnknownPageKind`，建议 `architecture` |
| `docs/feature/cart/cli/README.md` 已存在时的 `docs/feature/cart/cli.md` | 单页产生 `UnknownPageKind`：同一种类的单页与目录不能并存 |

```json
{"code": "UnknownPageKind", "category": "relation", "path": "docs/feature/cart/archtecture.md", "message": "Page kind is unknown: archtecture.md", "details": {"suggestions": ["architecture"]}}
```

修复方式是按内容把页面移到对应种类的文件或种类目录，并更新指向它的精确引用；Concord 不自动移动文件。

## 写作检查

```sh
concord docs check [<路径>...]
```

只检查写作与术语；`concord check` 把它和关系检查合在一起，见[合并检查](#合并检查)。省略 `<路径>` 时检查 `docs/writing.md` 声明的全部检查范围；传入一个或多个仓库相对文件或目录路径（例如 `concord docs check docs/feature/cart`）时，按各文件所在目录生效的 `concepts.md` 与 `writing.md` 检查所选范围内的 Markdown 正文与 SVG 图像文本（局部选择时不报告范围外的 `unusedConcept`），供编辑单篇文档、图表或单个 Feature 时快速验证。交付前的门禁仍运行无参数的 `concord check`。

finding 带文件、行号、规则与建议写法：

```text
docs/feature/cart/README.md:27 [bannedTerm] 单子: use 订单; docs/concepts.md#order
docs/architecture/flow.svg:12 [bannedTerm] 单子: use 订单; docs/concepts.md#order
```

`--json` 输出形如：

```json
{"category": "writing", "code": "bannedTerm", "path": "docs/architecture/flow.svg", "line": 12, "message": "单子: use 订单; docs/concepts.md#order"}
{"category": "writing", "code": "LegacyWritingPolicy", "path": "docs/concord-writing.json", "message": "Legacy concord-writing.json detected; convert rules to docs/writing.md"}
```

| finding | 什么时候出现 |
| --- | --- |
| `bannedTerm` | 正文或 SVG 文本用了“不用的词”或概念的旧写法 |
| `sentenceLength`、`paragraphLength` | 句子或段落超过上限 |
| `unusedConcept` | 概念在生效范围里没有被用到 |
| `AmbiguousConceptName` | 同一生效范围里有两个同名概念 |
| `InvalidConceptCatalog`、`InvalidWritingPolicy` | 文件结构不符合[文件格式](format.md)，消息带各违规项的行号与原因 |
| `LegacyWritingPolicy` | 检测到旧版 JSON 配置文件或 frontmatter 废弃词映射，需迁至 `writing.md` |

检查只报告，不改正文。
