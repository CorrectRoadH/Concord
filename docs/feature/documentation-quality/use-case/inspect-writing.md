# 检查正文与术语

## 用户目标

作者写完一页 Spec，想知道有没有用错词、句子是否太长、定义过的术语有没有被用上，并在交付前确认整个仓库没有问题。

## 起始状态

- `docs/concepts.md` 定义了“订单”，旧写法为“单子”。
- `docs/writing.md` 限制句子不超过 140 个字符。

## 完整路径

1. 运行写作检查。 {#run}

   ```sh
   concord docs check
   ```

   ```text
   Documentation writing: failed (47 files)
   docs/feature/cart/README.md:27 [bannedTerm] 单子: use 订单; docs/concepts.md#order
   ```

2. 按提示改正文，再运行一次。 {#fix}

   ```text
   Documentation writing: passed (47 files)
   ```

   检查不自动改正文，每处都由作者看上下文后修改。

3. 交付前运行合并检查。 {#check}

   ```sh
   concord check
   ```

   写作与关系都没有问题时退出 0，见[合并检查](../cli.md#合并检查)。

## 结果

| 情形 | 结果 |
| --- | --- |
| 句子超过上限 | `sentenceLength`，带行号与字符数 |
| 定义了概念却没用到 | `unusedConcept`，指向 `concepts.md` 里的定义 |
| `writing.md` 或 `concepts.md` 格式不对 | `InvalidWritingPolicy` 或 `InvalidConceptCatalog`，带行号与原因 |
| 仓库仍有旧版 JSON 写作规则 | `LegacyWritingPolicy`，提示迁移为 `writing.md` |
| SVG 图表文本包含不用的词 | `bannedTerm`，带 SVG 路径、行号与建议写法 |
| 检查期间文件被改动 | 自动重新检查，最多三次，每次间隔 50 毫秒；仍在变化时返回 `SourceChanged`，`complete` 为 false |

匹配规则与生效范围见[文件格式](../format.md)。

## 编辑期间的合并检查

`concord check` 和结构化 check action 在来源变化时重新执行完整检查，最多三次，只输出最后一次的结果并据此设置退出码。稳定的输入只运行一次；格式错误不重试，直接报告。
