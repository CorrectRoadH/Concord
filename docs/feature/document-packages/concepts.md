# 文档目录术语表

本页定义文档发现中的概念。[文档包](../../concepts.md#package)、[finding](../../concepts.md#finding)与 [owner](../../concepts.md#owner) 由[全局术语表](../../concepts.md)定义；目录与文件的位置规则由[文档模型](../../document-model.md)拥有。

## 受管文档 {#managed-document}

Concord 按文档模型从固定位置发现的文档：文档包的页面、Design、Issue 与 Memory。

## 页面种类 {#page-kind}

文档包中的页面按文件名得到的类别，例如 README、cli、architecture、format；无法归类的页面种类为 `unknown`。

## 文档类别 {#document-category}

决定关系与短选择器的文档分组：Feature、Use Case、Engineering、Roadmap、Design、Issue 与 Memory。

页面种类只说明一个附页回答哪个问题，不产生新的文档类别。Web 界面中的“分类”入口按文档类别分组。

## 种类目录 {#kind-directory}

一种页面写不下时代替 `<种类>.md` 的 `<种类>/` 目录，入口是其中的 `README.md`。其中的页面属于同一个页面种类。

## 附页 {#supporting-page}

文档包内 README 与 Use Case 以外的页面。附页按最深的合法 owner 归属。

旧写法：`支持页`、`支持页面`、`包内页面`
