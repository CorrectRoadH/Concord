# 按目录定义术语

## 用户目标

维护者想让一个词在整个项目里只有一个意思；同时允许两个 Feature 各自用同一个词表示不同的东西。

## 起始状态

- 项目已初始化，有 Feature `cart` 和 `billing`。

## 完整路径

1. 在全局术语表里定义整个项目共用的概念。 {#global}

   编辑 `docs/concepts.md`：

   ```markdown
   ## 订单 {#order}

   顾客提交的一次购买，包含商品、数量和收货地址。

   旧写法：`单子`
   ```

2. 在 Feature 目录里定义只在它内部使用的概念。 {#local}

   编辑 `docs/feature/billing/concepts.md`，定义只在计费里使用的“账期”。`cart` 目录里看不到这个定义，也可以另外定义同名的概念。

3. 列出全部术语和它们的来源。 {#list}

   ```sh
   concord concepts index
   ```

   每个概念显示写法、定义与所在文件。

## 结果

| 情形 | 结果 |
| --- | --- |
| 正文用了旧写法“单子” | `docs check` 报告 `bannedTerm`，建议改为“订单” |
| 正文链接 `concepts.md#ordr` | `check` 报告 `AnchorNotFound`，带路径与行号 |
| 全局与 `billing` 都定义了“账期” | `AmbiguousConceptName`，列出两处来源 |
| 二级标题缺少 `{#id}` | `InvalidConceptCatalog`，带行号 |
| 子目录声明“不继承上级不用的词” | 该目录及其子目录不检查祖先目录的违例词 |
| 子目录声明“不限制句长与段长” | 该目录及其子目录不报告 `sentenceLength` 与 `paragraphLength` |

文件格式见 [concepts.md](../format.md#conceptsmd)。
