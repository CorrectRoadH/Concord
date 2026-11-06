# Web 工作台术语表

本页定义 Web 工作台中的概念。[全局术语表](../../concepts.md)中的[草稿](../../concepts.md#draft)、[前像](../../concepts.md#preimage)、[投影](../../concepts.md#projection)与[图解](../../concepts.md#diagram)自动适用于本目录。

## Web 工作台 {#workbench}

`concord view` 启动、由[工作区服务](../../concepts.md#workspace-server)提供的浏览器界面。它读写仓库里的文件，与 CLI 执行同一套领域校验。

本目录中单独写“工作台”时指它。

## 工作区投影 {#workspace-projection}

工作区服务在后台维护的一份不含正文的导航结构，包括路径、摘要、关系、finding 与概念目录。Web 导航与 `workspace projection` 读取它；它不表示当前来源有效。

旧写法：`结构投影`、`工作区结构投影`

它是一种[历史投影](../local-data-engine/concepts.md#historical-projection)。

## 自动保存 {#autosave}

编辑器停止输入 800ms 后，以编辑前像的整文件摘要为条件把草稿写回 worktree 中的文件，不暂存、不提交。文件被别人改过时保存被拒绝，草稿保留。

## 内容导航 {#content-navigation}

工作台中列出当前分类全部条目与筛选输入的一列：桌面上常驻在主侧栏右侧，手机上是内容抽屉。点击条目只切换右侧预览。

旧写法：`第二侧栏`

## p5 图块 {#p5-block}

围栏语言为 `p5` 的代码块，或指向仓库内入口文件的图块，在阅读与编辑页面的沙箱中运行。Spec 中的 p5 动画用它书写。

旧写法：`p5 交互图解`

## PR 预览 {#pr-preview}

`concord view export` 从 base 与 head 两个 commit 导出的静态只读页面与 `changes.json`，由 CI 部署给审阅者。

## 概念目录 {#concept-catalog}

工作区投影中列出的每份 `concepts.md` 的路径，以及其中各概念的写法、ID 与旧写法，不含定义正文。
