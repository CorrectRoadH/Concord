# 阅读 Spec 与它的测试和实现

## 用户目标

维护者在监督 agent 时，想读懂 agent 正在实现的 Feature：它能做什么、每个 Use Case 怎样走、由哪些测试守护、用到的名词是什么意思。

## 起始状态

- 仓库已初始化，有 Feature `cart` 与它的 Use Case `add-item`，测试和代码都已标记。

## 完整路径

1. 在文档树里点 Feature `cart`。 {#open-feature}

   右侧按 Markdown 显示 README：能做什么、上手示例、怎样工作。文档树在 `cart` 下展开它的全部页面：README、architecture、cli、种类目录中的页面与每个 Use Case。种类目录（例如 `architecture/`）显示为一个节点，点开显示其 `README.md`；无法归类的页面同样列出。

2. 点 Use Case“加入商品”。 {#open-use-case}

   正文下方按步骤列出守护它的测试与实现它的代码：

   ```text
   测试
     test/cart.test.js:1  adding the same sku twice sums the quantity
   实现
     src/cart.js        docs/feature/cart/README.md
   ```

   点一项，跳到对应文件的那一行。

3. 点正文里的术语链接。 {#open-concept}

   弹出该术语的定义和它所在的 `concepts.md`。

## 结果

不离开 Herdr 就能读完一个 Feature 和它的测试与实现。读到的内容与 `concord show` 的结果一致。

“其它文档”列出项目的固定入口（文档导航、架构、文档模型、品味、术语、写作规则），以及从已列出页面的正文链接可以到达的页面；没有被任何页面链接的零散 Markdown 不出现在文档树里。
