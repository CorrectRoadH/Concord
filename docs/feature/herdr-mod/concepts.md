# 在 Herdr 里使用 Concord 的术语表

本页定义 Herdr 界面中的概念。[草稿](../../concepts.md#draft)与[项目目录](../../concepts.md#project-directory)由[全局术语表](../../concepts.md)定义。

## Concord mod {#concord-mod}

Concord 随归档提供的 Herdr 原生界面扩展。它通过公开 CLI 读取文档、关系与检查结果，不保存事实。

本产品写 Concord mod；泛指 Herdr 的任意扩展时写 mod。Feature 目录名 `herdr-mod` 与命令 `concord herdr install` 照原样书写。

## 文档列表 {#document-tree}

Concord mod 左栏的导航树，按 Feature、品味、术语、Issue、Memory 与其它文档分组。

## 原位预览 {#live-preview}

文档的未编辑块显示排版后的内容，当前编辑块在原位置显示 Markdown 源码的交互方式。点击文字或图表进入该块，离开后恢复预览，不切换整篇文档的阅读与编辑模式。
