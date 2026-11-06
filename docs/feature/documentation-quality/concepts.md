# 文档写作术语表

本页定义写作检查中的概念。[概念](../../concepts.md#concept)、[旧写法](../../concepts.md#deprecated-name)、[写作规则](../../concepts.md#writing-rules)、[合并检查](../../concepts.md#combined-check)与 [finding](../../concepts.md#finding) 由[全局术语表](../../concepts.md)定义。

## 不用的词 {#banned-word}

`writing.md`“不用的词”表中的一行，写明改成什么、理由、只在哪些目录生效与例外。正文出现时，检查报告 `bannedTerm`。

旧写法：`禁词`

正文出现旧写法时同样报告 `bannedTerm`；不用的词写在写作规则里，旧写法写在概念定义后。

## 写作检查 {#writing-check}

按生效的概念与写作规则检查正文：旧写法、不用的词、句长与段长，以及没被用到的概念。`concord docs check` 单独运行它，它也是合并检查的一部分。

## 生效范围 {#effective-scope}

一份 `concepts.md` 或 `writing.md` 生效的目录，即它所在的目录及其子目录。全局 `docs/concepts.md` 的生效范围是整个检查范围。

## 检查范围 {#check-roots}

`docs/writing.md`“检查范围”一节列出的、参与写作检查的目录与文件；省略时只检查 `docs`。

检查范围决定检查读哪些文件，生效范围决定一份术语表或写作规则管到哪些文件。
