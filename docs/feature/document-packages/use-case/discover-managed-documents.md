# 完整发现受管文档

维护者打开消费仓库，从 CLI 和 Web 发现当前格式的 Feature、Engineering、Roadmap、Design 与 Issue。Feature、Engineering 与 Roadmap 由目录与 README 的一级标题确定，Design 与 Issue 是单个文件；索引与模板保持各自角色。

发现读取当前配置与受管来源集合。无效格式产生路径明确的诊断，结果标注不完整；不猜测已采用或已裁决状态，不转换或重写输入。嵌套 owner 截断祖先归属，材料仍可从主题树访问。

包内每个 Markdown 页面按[路径与识别](../../../document-model.md#路径与识别)得到页面种类。无法归类的页面照常被发现，`show` 的 `pages` 中种类为 `unknown`，可以阅读与编辑；`check` 报告 `UnknownPageKind`，见[页面种类检查](../../documentation-quality/cli.md#页面种类)。这类页面已经读到，不使结果不完整。

验收覆盖当前主题的完整发现、无效输入诊断、CLI 与 Web 一致性及原文保留。结构检查不产生测试执行证据。
